#!/usr/bin/env node
/**
 * Thin launcher so `npx agent-inspector` works before/after build.
 * Prefers compiled dist; falls back to tsx in development.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distCli = join(root, "dist", "cli.js");

if (existsSync(distCli)) {
  await import(pathToFileURL(distCli).href);
} else {
  const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const entry = join(root, "src", "cli.ts");
  const child = spawn(
    process.execPath,
    [existsSync(tsxCli) ? tsxCli : "tsx", entry, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      cwd: root,
      env: process.env,
      shell: process.platform === "win32",
    }
  );
  child.on("exit", (code) => process.exit(code ?? 1));
}
