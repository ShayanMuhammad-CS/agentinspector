/**
 * Real support-desk agent — processes TICKET-1001 using real local files.
 *
 * This is how Agent Action Inspector is meant to be used:
 *   - Agent calls tools that touch real state (files / outbox)
 *   - Risky tools (write / email) go through the inspector Approve/Deny gate
 *   - Full trajectory is saved for replay
 *
 * Prerequisites:
 *   ollama serve
 *   ollama pull llama3.2   (or set OLLAMA_MODEL=llama3.2:1b)
 *
 * --- Replay after the run (most common) ---
 *   node examples/real-agent/run.mjs
 *   pnpm --filter @kashifmuhammad/agent-inspector start -- --log examples/runs/support-desk-last.json --port 8811
 *
 * --- Live HITL (production-style) ---
 *   terminal A: pnpm --filter @kashifmuhammad/agent-inspector start -- --live --port 8811
 *   terminal B: node examples/real-agent/run.mjs --live
 *               (or --scripted --live for a guaranteed multi-tool path)
 *
 * Flags:
 *   --live       stream events + pause on risky tools
 *   --scripted   skip LLM; run the fixed ticket workflow (still real FS + inspector)
 *   --ticket=ID  default TICKET-1001
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInspectorClient } from "./inspector-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKSPACE = join(__dirname, "workspace");
const OUTBOX = join(__dirname, "outbox");
const RUNS = join(ROOT, "examples/runs");
const OUT_FILE = join(RUNS, "support-desk-last.json");

const OLLAMA = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:1b";
const INSPECTOR = (process.env.INSPECTOR_URL ?? "http://127.0.0.1:8811").replace(/\/$/, "");
const LIVE = process.argv.includes("--live");
const SCRIPTED = process.argv.includes("--scripted");
const TICKET_ID =
  process.argv.find((a) => a.startsWith("--ticket="))?.slice(9) ?? "TICKET-1001";

const inspector = createInspectorClient({ baseUrl: INSPECTOR, live: LIVE });

/** @type {Array<Record<string, unknown>>} */
const transcript = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function resetWorkspace() {
  writeJson(join(WORKSPACE, "ticket-status.json"), {
    tickets: {
      "TICKET-1001": { status: "open", assignee: null, updatedAt: null },
    },
  });
  mkdirSync(OUTBOX, { recursive: true });
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_tickets",
      description: "List ticket files in the support workspace",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_ticket",
      description: "Read a support ticket markdown file by id, e.g. TICKET-1001",
      parameters: {
        type: "object",
        required: ["ticketId"],
        properties: { ticketId: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_order",
      description: "Look up an order in orders.json by orderId, e.g. ORD-4821",
      parameters: {
        type: "object",
        required: ["orderId"],
        properties: { orderId: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_portal_link",
      description: "Create a fresh billing portal link for a paid order (side effect)",
      parameters: {
        type: "object",
        required: ["orderId", "customerId"],
        properties: {
          orderId: { type: "string" },
          customerId: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send email by writing a real message file into the outbox folder",
      parameters: {
        type: "object",
        required: ["to", "subject", "body"],
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_ticket_status",
      description: "Update ticket status on disk (open|resolved|pending)",
      parameters: {
        type: "object",
        required: ["ticketId", "status"],
        properties: {
          ticketId: { type: "string" },
          status: { type: "string" },
        },
      },
    },
  },
];

function normalizeArgs(name, raw) {
  let args = raw;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return {};
    }
  }
  if (!args || typeof args !== "object") return {};
  const obj = /** @type {Record<string, unknown>} */ (args);
  if (obj.parameters && typeof obj.parameters === "object") return normalizeArgs(name, obj.parameters);
  if (obj.arguments && typeof obj.arguments === "object") return normalizeArgs(name, obj.arguments);
  const cleaned = { ...obj };
  for (const k of ["type", "function", "name", name, ...TOOLS.map((t) => t.function.name)]) {
    delete cleaned[k];
  }
  return cleaned;
}

/** Real side effects on local disk */
function executeTool(name, args) {
  switch (name) {
    case "list_tickets": {
      const dir = join(WORKSPACE, "tickets");
      return { tickets: readdirSync(dir).filter((f) => f.endsWith(".md")) };
    }
    case "read_ticket": {
      const id = String(args.ticketId ?? "");
      const path = join(WORKSPACE, "tickets", `${id}.md`);
      if (!existsSync(path)) return { error: `ticket ${id} not found` };
      return { ticketId: id, content: readFileSync(path, "utf8") };
    }
    case "lookup_order": {
      const orderId = String(args.orderId ?? "");
      const db = readJson(join(WORKSPACE, "orders.json"));
      const order = db.orders?.[orderId];
      if (!order) return { error: `order ${orderId} not found` };
      return order;
    }
    case "create_portal_link": {
      const orderId = String(args.orderId ?? "");
      const customerId = String(args.customerId ?? "");
      const token = `sess_${Date.now().toString(36)}`;
      const url = `https://billing.example.com/portal/${customerId}/${orderId}?t=${token}`;
      const record = {
        orderId,
        customerId,
        url,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
      mkdirSync(OUTBOX, { recursive: true });
      writeJson(join(OUTBOX, `portal-${orderId}.json`), record);
      return record;
    }
    case "send_email": {
      const to = String(args.to ?? "");
      const subject = String(args.subject ?? "");
      const body = String(args.body ?? "");
      mkdirSync(OUTBOX, { recursive: true });
      const file = join(OUTBOX, `email-${Date.now()}.json`);
      const msg = {
        to,
        subject,
        body,
        queuedAt: new Date().toISOString(),
        status: "queued",
      };
      writeJson(file, msg);
      return { ...msg, path: file };
    }
    case "update_ticket_status": {
      const ticketId = String(args.ticketId ?? "");
      const status = String(args.status ?? "");
      const path = join(WORKSPACE, "ticket-status.json");
      const db = readJson(path);
      if (!db.tickets[ticketId]) db.tickets[ticketId] = {};
      db.tickets[ticketId].status = status;
      db.tickets[ticketId].updatedAt = new Date().toISOString();
      db.tickets[ticketId].assignee = "support-desk-agent";
      writeJson(path, db);
      return db.tickets[ticketId];
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

async function callTool(name, rawArgs, stepTag) {
  const args = normalizeArgs(name, rawArgs);
  const toolCallId = `${name}_${stepTag}`;

  const decision = await inspector.beforeTool(name, toolCallId, args);
  if (decision === "deny") {
    const denied = { error: "denied_by_operator", tool: name };
    await inspector.afterTool(name, toolCallId, denied, true);
    transcript.push({
      type: "ai",
      content: "",
      tool_calls: [{ id: toolCallId, name, args }],
    });
    transcript.push({
      type: "tool",
      name,
      tool_call_id: toolCallId,
      content: JSON.stringify(denied),
    });
    console.log(`  ✗ ${name} DENIED`);
    return { denied: true, output: denied };
  }

  const output = executeTool(name, args);
  const isError = Boolean(output && typeof output === "object" && "error" in output);
  await inspector.afterTool(name, toolCallId, output, isError);

  transcript.push({
    type: "ai",
    content: "",
    tool_calls: [{ id: toolCallId, name, args }],
  });
  transcript.push({
    type: "tool",
    name,
    tool_call_id: toolCallId,
    content: JSON.stringify(output),
  });

  console.log(`  → ${name}`, JSON.stringify(args));
  console.log(`    ⇐`, JSON.stringify(output));
  return { denied: false, output };
}

async function ensureOllama() {
  const res = await fetch(`${OLLAMA}/api/tags`);
  if (!res.ok) throw new Error(`Ollama not reachable at ${OLLAMA}`);
  const data = await res.json();
  const names = (data.models ?? []).map((m) => m.name);
  const ok = names.some((n) => n === MODEL || n.startsWith(`${MODEL}`) || n.startsWith(MODEL.split(":")[0]));
  if (!ok) {
    throw new Error(`Model ${MODEL} not installed. Have: ${names.join(", ") || "(none)"}`);
  }
}

async function ollamaChat(messages) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages,
      tools: TOOLS,
      options: { temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama chat failed: ${await res.text()}`);
  return res.json();
}

/** Guaranteed real workflow — same tools + side effects a good agent should run */
async function runScripted() {
  console.log("Mode: SCRIPTED real workflow (no LLM variance)\n");
  const user = `Process ${TICKET_ID}: confirm order, create portal link, email customer, resolve ticket.`;
  transcript.push({ type: "human", content: user });
  await inspector.reasoning(`[user] ${user}`);

  await inspector.reasoning(
    "I will read the ticket, look up the order, create a portal link, email the customer, then resolve the ticket."
  );
  transcript.push({
    type: "ai",
    content:
      "I will read the ticket, look up the order, create a portal link, email the customer, then resolve the ticket.",
  });

  await callTool("read_ticket", { ticketId: TICKET_ID }, "1");
  const orderRes = await callTool("lookup_order", { orderId: "ORD-4821" }, "2");
  if (orderRes.denied) return;

  const portal = await callTool(
    "create_portal_link",
    { orderId: "ORD-4821", customerId: "cust_918" },
    "3"
  );
  if (portal.denied) return;

  const url = portal.output?.url ?? "(no url)";
  const email = await callTool(
    "send_email",
    {
      to: "billing@acme.co",
      subject: "Fresh portal link for invoice INV-4821",
      body: `Hi — here is a new portal link for order ORD-4821:\n\n${url}\n\nThanks,\nSupport`,
    },
    "4"
  );
  if (email.denied) return;

  await callTool(
    "update_ticket_status",
    { ticketId: TICKET_ID, status: "resolved" },
    "5"
  );

  transcript.push({
    type: "ai",
    content: "Ticket processed: portal link emailed and ticket marked resolved.",
  });
  await inspector.reasoning("Ticket processed: portal link emailed and ticket marked resolved.");
}

async function runWithLlm() {
  console.log(`Mode: LLM agent via Ollama (${MODEL})\n`);
  await ensureOllama();

  const user = `You are the support-desk agent. Process ${TICKET_ID} end-to-end using tools. Read the ticket, look up the order id mentioned in it, create a portal link, email the customer the link, and mark the ticket resolved. Use flat JSON tool args only. Do not invent data.`;
  transcript.push({ type: "human", content: user });
  await inspector.reasoning(`[user] ${user}`);

  /** @type {Array<Record<string, unknown>>} */
  const messages = [
    {
      role: "system",
      content:
        "You are a support-desk agent. Use tools for every step. Never invent order or email data. Sequence: read_ticket → lookup_order → create_portal_link → send_email → update_ticket_status. Flat JSON args only.",
    },
    { role: "user", content: user },
  ];

  for (let step = 0; step < 8; step++) {
    process.stdout.write(`LLM step ${step + 1}… `);
    const reply = await ollamaChat(messages);
    const msg = reply.message ?? {};
    const calls = msg.tool_calls ?? [];
    console.log(calls.length ? calls.map((c) => c.function?.name).join(", ") : "final text");

    messages.push(msg);
    if (msg.content) {
      transcript.push({ type: "ai", content: msg.content });
      await inspector.reasoning(msg.content);
    }

    if (!calls.length) break;

    for (let i = 0; i < calls.length; i++) {
      const tc = calls[i];
      const name = tc.function?.name ?? "tool";
      const raw = tc.function?.arguments ?? {};
      const { denied, output } = await callTool(name, raw, `${step}_${i}`);
      const toolMsg = {
        role: "tool",
        tool_name: name,
        name,
        content: JSON.stringify(output),
      };
      messages.push(toolMsg);
      if (denied) return;
    }
  }
}

function saveRun() {
  mkdirSync(RUNS, { recursive: true });
  const log = {
    agentName: "support-desk-agent",
    messages: transcript,
  };
  writeFileSync(OUT_FILE, JSON.stringify(log, null, 2), "utf8");
  console.log(`\nWrote trajectory: ${OUT_FILE}`);
  console.log(`Outbox (real side effects): ${OUTBOX}`);
  console.log(`Ticket status: ${join(WORKSPACE, "ticket-status.json")}`);
  if (!LIVE) {
    console.log("\nInspect with:");
    console.log(
      `  pnpm --filter @kashifmuhammad/agent-inspector start -- --log examples/runs/support-desk-last.json --port 8811`
    );
  } else {
    console.log("\nLive events were streamed to the inspector.");
  }
}

async function main() {
  console.log("Support-desk agent (real local side effects)");
  console.log(`Ticket     ${TICKET_ID}`);
  console.log(`Inspector  ${LIVE ? `LIVE → ${INSPECTOR}` : "file replay after run"}`);
  console.log(`Workspace  ${WORKSPACE}`);
  console.log("");

  resetWorkspace();

  if (SCRIPTED) await runScripted();
  else await runWithLlm();

  saveRun();
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : err));
  process.exit(1);
});
