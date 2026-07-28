/**
 * Minimal bridge: forward LangGraph-style stream events to a local inspector.
 *
 * Usage:
 *   1. terminal A:  pnpm --filter agent-inspector start -- --live --port 8787
 *   2. terminal B:  node examples/live-bridge.mjs
 *
 * Your real agent should POST each astream_events chunk the same way.
 * When a high-risk tool is ingested, the POST hangs until you Approve/Deny in the UI.
 */

const BASE = process.env.INSPECTOR_URL ?? "http://127.0.0.1:8787";

async function ingest(payload) {
  const res = await fetch(`${BASE}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

async function main() {
  console.log(`Sending demo live events → ${BASE}`);

  await ingest({
    event: "on_chat_model_end",
    data: {
      output: {
        content:
          "I need to notify the on-call channel about the spike, then open an incident ticket.",
      },
    },
  });

  await ingest({
    event: "on_tool_start",
    data: {
      name: "read_metrics",
      id: "tc_live_1",
      input: { service: "checkout", window: "15m" },
    },
  });

  await ingest({
    event: "on_tool_end",
    data: {
      name: "read_metrics",
      id: "tc_live_1",
      output: { errorRate: 0.12, p99ms: 1800 },
    },
  });

  console.log("Next event requires approval — check the dashboard, then Approve/Deny…");

  const gated = await ingest({
    event: "on_tool_start",
    data: {
      name: "send_slack",
      id: "tc_live_2",
      input: {
        channel: "#oncall",
        message: "Checkout error rate 12% — opening incident.",
      },
    },
    approvalConfig: { minRiskForApproval: "high" },
  });

  console.log("Operator decision:", gated.decision);

  if (gated.decision === "approve") {
    await ingest({
      event: "on_tool_end",
      data: {
        name: "send_slack",
        id: "tc_live_2",
        output: { ok: true, ts: Date.now() },
      },
    });
    console.log("Slack send completed.");
  } else {
    console.log("Slack send skipped (denied).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
