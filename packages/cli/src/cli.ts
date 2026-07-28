import {
  adaptRunLog,
  listAdapters,
  MOCK_RUN,
  type AdapterId,
  type AgentRunLog,
} from "@kashifmuhammad/agent-inspector-core";
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseUrl } from "node:url";
import next from "next";
import open from "open";
import { getBus } from "./bus.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

async function loadLogFile(
  path: string,
  adapter: AdapterId
): Promise<{ log: AgentRunLog; adapter: string }> {
  const candidates = isAbsolute(path)
    ? [path]
    : [resolve(process.cwd(), path), resolve(REPO_ROOT, path)];
  const abs = candidates.find((p) => existsSync(p));
  if (!abs) {
    throw new Error(
      `Log file not found. Tried: ${candidates.map((c) => `"${c}"`).join(", ")}`
    );
  }
  const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
  const result = adaptRunLog(raw, {
    adapter,
    emitApprovalRequests: true,
  });
  return { log: result.log, adapter: result.adapter };
}

async function main(): Promise<void> {
  // pnpm script forwarding can insert standalone "--" tokens.
  const userArgs = process.argv.slice(2).filter((arg) => arg !== "--");
  const program = new Command();
  program
    .name("agent-inspector")
    .description(
      "Local dashboard for agent trajectories. Runs fully offline on localhost."
    )
    .option("-l, --log <path>", "Path to a JSON event log (file / replay mode)")
    .option("-p, --port <number>", "Port for the local server", "8787")
    .option(
      "--adapter <name>",
      `Log adapter: ${listAdapters().join(" | ")}`,
      "auto"
    )
    .option(
      "--live",
      "Start in live/SSE mode (accept POST /api/ingest from your agent bridge)"
    )
    .option("--no-open", "Do not auto-open the browser")
    .option("--dev", "Run Next.js in development mode")
    .parse(userArgs, { from: "user" });

  const opts = program.opts<{
    log?: string;
    port: string;
    adapter: string;
    live?: boolean;
    open: boolean;
    dev?: boolean;
  }>();

  const adapter = (opts.adapter || "auto") as AdapterId;
  if (!listAdapters().includes(adapter)) {
    throw new Error(
      `Unknown adapter "${opts.adapter}". Use one of: ${listAdapters().join(", ")}`
    );
  }

  const port = Number(opts.port) || 8787;
  const bus = getBus();

  if (opts.log) {
    const { log, adapter: used } = await loadLogFile(opts.log, adapter);
    bus.loadRun(log, opts.log);
    console.log(
      `Loaded run log: ${opts.log} (${log.events.length} events) [adapter=${used}]`
    );
  } else if (opts.live) {
    bus.startLive(`run_live_${Date.now()}`, "live-agent");
    console.log("Live mode - POST events to /api/ingest (LangGraph stream shape or native events)");
  } else {
    bus.loadRun(MOCK_RUN);
    console.log("No --log provided - loading built-in mock run (demo mode)");
  }

  // Expose bus path for API routes that import from the same package
  process.env.AGENT_INSPECTOR_PORT = String(port);
  process.env.AGENT_INSPECTOR_MODE = bus.session.mode;

  const hasProdBuild = existsSync(join(PACKAGE_ROOT, ".next", "BUILD_ID"));
  const dev =
    Boolean(opts.dev) ||
    process.env.NODE_ENV === "development" ||
    !hasProdBuild;
  if (!hasProdBuild && !opts.dev) {
    console.log("No production build found - starting Next.js in dev mode");
  }
  const app = next({
    dev,
    dir: PACKAGE_ROOT,
    hostname: "127.0.0.1",
    port,
  });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    const parsed = parseUrl(req.url!, true);
    void handle(req, res, parsed);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.listen(port, "127.0.0.1", () => resolveListen());
    server.on("error", reject);
  });

  const url = `http://127.0.0.1:${port}`;
  console.log("");
  console.log("  Agent Action Inspector");
  console.log(`  -> ${url}`);
  console.log("");
  if (bus.session.mode === "live") {
    console.log("  Ingest:   POST /api/ingest   (LangGraph stream events)");
    console.log("  Stream:   GET  /api/stream   (SSE for the dashboard)");
    console.log("  Approve:  POST /api/approval { toolCallId, decision }");
    console.log("");
  }
  console.log("  Press Ctrl+C to stop.");
  console.log("");

  if (opts.open !== false) {
    try {
      await open(url);
    } catch {
      console.warn("Could not auto-open browser - open the URL above manually.");
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

