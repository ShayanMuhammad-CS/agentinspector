/**
 * Real-data demo: run a tool-calling agent on local Ollama, then
 * open the trajectory in Agent Action Inspector.
 *
 * Prerequisites:
 *   1. Ollama running:  ollama serve
 *   2. A tool-capable model, e.g.:
 *        ollama pull llama3.1
 *        ollama pull qwen2.5
 *        ollama pull mistral-nemo
 *
 * Usage:
 *   # 1) Generate a real run log
 *   node examples/ollama-agent/run.mjs
 *
 *   # 2) Inspect it (another terminal, or after it finishes)
 *   pnpm --filter @kashifmuhammad/agent-inspector start -- --log examples/runs/ollama-last.json
 *
 * Live mode (HITL — high-risk tools pause until you Approve/Deny):
 *   terminal A:  pnpm --filter @kashifmuhammad/agent-inspector start -- --live --port 8787
 *   terminal B:  node examples/ollama-agent/run.mjs --live
 *
 * Env:
 *   OLLAMA_HOST   default http://127.0.0.1:11434
 *   OLLAMA_MODEL  default llama3.1 (override if you use another model)
 *   INSPECTOR_URL default http://127.0.0.1:8787
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_DIR = join(ROOT, "examples/runs");
const OUT_FILE = join(OUT_DIR, "ollama-last.json");

const OLLAMA = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";
const INSPECTOR = (process.env.INSPECTOR_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const LIVE = process.argv.includes("--live");
const PROMPT =
  process.argv.find((a) => a.startsWith("--prompt="))?.slice(9) ??
  "Customer cannot open invoice 4821. Look it up, create a portal link for cust_918, and email billing@acme.co the link. Be concise.";

/** Fake backend so the agent does real tool calls without cloud deps */
const DB = {
  invoices: {
    "4821": {
      invoiceId: "4821",
      status: "paid",
      customerId: "cust_918",
      amount: 2400,
      currency: "USD",
    },
  },
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "lookup_invoice",
      description: "Look up an invoice by id. Safe read-only.",
      parameters: {
        type: "object",
        required: ["invoiceId"],
        properties: {
          invoiceId: { type: "string", description: "Invoice id, e.g. 4821" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_portal_link",
      description: "Create a billing portal link for a customer. Writes state.",
      parameters: {
        type: "object",
        required: ["customerId", "invoiceId"],
        properties: {
          customerId: { type: "string" },
          invoiceId: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email to a recipient. Side-effecting / high risk.",
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
];

/**
 * Tiny models (e.g. llama3.2:1b) often wrap args oddly:
 *   { parameters: { invoiceId } }
 *   { lookup_invoice: "...", parameters: { ... } }
 *   { function: "lookup_invoice", parameters: { ... } }
 */
function normalizeToolArgs(name, raw) {
  let args = raw;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return {};
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};

  const obj = /** @type {Record<string, unknown>} */ (args);
  if (obj.parameters && typeof obj.parameters === "object") {
    return normalizeToolArgs(name, obj.parameters);
  }
  if (obj.arguments && typeof obj.arguments === "object") {
    return normalizeToolArgs(name, obj.arguments);
  }
  if (obj[name] && typeof obj[name] === "object") {
    return normalizeToolArgs(name, obj[name]);
  }

  // Drop junk keys tiny models invent
  const cleaned = { ...obj };
  delete cleaned.type;
  delete cleaned.function;
  delete cleaned.name;
  delete cleaned.lookup_invoice;
  delete cleaned.create_portal_link;
  delete cleaned.send_email;
  return cleaned;
}

function runTool(name, args) {
  switch (name) {
    case "lookup_invoice": {
      const id = args.invoiceId ?? args.id ?? args.invoice_id;
      const row = DB.invoices[String(id)];
      if (!row) return { error: `invoice ${id} not found` };
      return row;
    }
    case "create_portal_link":
      return {
        url: `https://billing.example.com/portal/${args.customerId}/${args.invoiceId}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    case "send_email":
      return {
        messageId: `msg_${Math.random().toString(36).slice(2, 8)}`,
        status: "queued",
        to: args.to,
      };
    default:
      return { error: `unknown tool ${name}` };
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function ensureOllama() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const names = (data.models ?? []).map((m) => m.name);
    if (names.length === 0) {
      throw new Error("No models installed. Run: ollama pull llama3.1");
    }
    const hasModel = names.some(
      (n) => n === MODEL || n.startsWith(`${MODEL}:`) || n.startsWith(MODEL)
    );
    if (!hasModel) {
      console.warn(`Model "${MODEL}" not found. Installed: ${names.join(", ")}`);
      console.warn(`Pull it with: ollama pull ${MODEL}`);
      console.warn(`Or set OLLAMA_MODEL to one of the installed names.`);
      throw new Error(`Model ${MODEL} missing`);
    }
    return names;
  } catch (e) {
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA}. Start it with: ollama serve\n(${e.message})`
    );
  }
}

async function ingest(payload) {
  if (!LIVE) return null;
  const res = await fetch(`${INSPECTOR}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ingest failed: ${JSON.stringify(json)}`);
  return json;
}

function toLangChainMessages(ollamaMessages) {
  /** Shape the inspector LangGraph adapter already understands */
  return ollamaMessages.map((m) => {
    if (m.role === "user") return { type: "human", content: m.content ?? "" };
    if (m.role === "assistant") {
      const tool_calls = (m.tool_calls ?? []).map((tc, i) => ({
        id: tc.function?.name ? `${tc.function.name}_${i}` : `call_${i}`,
        name: tc.function?.name ?? "tool",
        args: tc.function?.arguments ?? {},
      }));
      return {
        type: "ai",
        content: m.content ?? "",
        tool_calls: tool_calls.length ? tool_calls : undefined,
      };
    }
    if (m.role === "tool") {
      return {
        type: "tool",
        name: m.tool_name ?? m.name ?? "tool",
        tool_call_id: m.tool_call_id ?? "call_0",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
    }
    return { type: "human", content: String(m.content ?? "") };
  });
}

async function main() {
  console.log(`Ollama  ${OLLAMA}`);
  console.log(`Model   ${MODEL}`);
  console.log(`Mode    ${LIVE ? `live → ${INSPECTOR}` : `file → ${OUT_FILE}`}`);
  console.log(`Prompt  ${PROMPT}`);
  console.log("");

  await ensureOllama();

  const messages = [
    {
      role: "system",
      content:
        "You are a support triage agent. Always use tools — never invent tool schemas in text. Call tools one at a time with flat JSON args only (e.g. {\"invoiceId\":\"4821\"}). Required sequence: 1) lookup_invoice 2) create_portal_link 3) send_email. Keep the final answer to one short sentence.",
    },
    { role: "user", content: PROMPT },
  ];

  // Record only user/assistant/tool turns for the inspector (skip system)
  const transcript = [{ role: "user", content: PROMPT }];

  if (LIVE) {
    await ingest({
      event: "on_chat_model_end",
      data: { output: { content: `[user] ${PROMPT}` } },
    });
  }

  const maxSteps = 6;
  for (let step = 0; step < maxSteps; step++) {
    process.stdout.write(`LLM step ${step + 1}… `);
    const reply = await ollamaChat(messages);
    const msg = reply.message ?? {};
    console.log(
      msg.tool_calls?.length
        ? `tool_calls: ${msg.tool_calls.map((t) => t.function?.name).join(", ")}`
        : "final text"
    );

    messages.push(msg);
    transcript.push(msg);

    if (LIVE && (msg.content || msg.tool_calls?.length)) {
      await ingest({
        event: "on_chat_model_end",
        data: {
          output: {
            content: msg.content ?? "",
            tool_calls: (msg.tool_calls ?? []).map((tc, i) => ({
              id: `${tc.function?.name ?? "tool"}_${i}`,
              name: tc.function?.name,
              args: tc.function?.arguments ?? {},
            })),
          },
        },
      });
    }

    const calls = msg.tool_calls ?? [];
    if (!calls.length) break;

    for (let i = 0; i < calls.length; i++) {
      const tc = calls[i];
      const name = tc.function?.name ?? "tool";
      const rawArgs = tc.function?.arguments ?? {};
      const args = normalizeToolArgs(name, rawArgs);
      const toolCallId = `${name}_${i}`;

      // Keep transcript/inspector aligned with the normalized args we actually ran
      if (tc.function) tc.function.arguments = args;

      if (LIVE) {
        const gated = await ingest({
          event: "on_tool_start",
          data: { name, id: toolCallId, input: args },
          approvalConfig: { minRiskForApproval: "high" },
        });
        if (gated?.paused && gated.decision === "deny") {
          const denied = {
            role: "tool",
            tool_name: name,
            tool_call_id: toolCallId,
            content: JSON.stringify({ error: "denied_by_operator" }),
          };
          messages.push(denied);
          transcript.push(denied);
          console.log(`  ✗ ${name} denied by operator`);
          continue;
        }
      }

      const output = runTool(name, args);
      console.log(`  → ${name}`, JSON.stringify(args), "⇒", JSON.stringify(output));

      const toolMsg = {
        role: "tool",
        tool_name: name,
        name,
        tool_call_id: toolCallId,
        content: JSON.stringify(output),
      };
      messages.push(toolMsg);
      transcript.push(toolMsg);

      if (LIVE) {
        await ingest({
          event: "on_tool_end",
          data: { name, id: toolCallId, output },
        });
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const log = {
    agentName: `ollama-${MODEL}`,
    messages: toLangChainMessages(transcript),
  };
  writeFileSync(OUT_FILE, JSON.stringify(log, null, 2), "utf8");
  console.log("");
  console.log(`Wrote ${OUT_FILE}`);
  if (!LIVE) {
    console.log("");
    console.log("Inspect with:");
    console.log(
      `  pnpm --filter @kashifmuhammad/agent-inspector start -- --log examples/runs/ollama-last.json`
    );
  } else {
    console.log("Live events were streamed to the inspector dashboard.");
  }
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : err));
  process.exit(1);
});
