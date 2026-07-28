/**
 * Inspector client — the same pattern you'd use inside a real LangGraph tool wrapper.
 *
 * Live mode: POST /api/ingest and wait for Approve/Deny on gated tools.
 * File mode: no network; caller writes a run log at the end.
 */

export function createInspectorClient({
  baseUrl = process.env.INSPECTOR_URL ?? "http://127.0.0.1:8811",
  live = false,
} = {}) {
  const base = String(baseUrl).replace(/\/$/, "");

  async function ingest(payload) {
    if (!live) return { ok: true, paused: false, skipped: true };
    const res = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Inspector ingest failed (${res.status}): ${JSON.stringify(json)}`);
    }
    return json;
  }

  return {
    live,
    base,
    async reasoning(content) {
      return ingest({
        event: "on_chat_model_end",
        data: { output: { content } },
      });
    },
    /**
     * Call BEFORE executing a tool. In live mode, high-risk tools block until UI decision.
     * @returns {"approve"|"deny"|null}
     */
    async beforeTool(name, toolCallId, input) {
      const result = await ingest({
        event: "on_tool_start",
        data: { name, id: toolCallId, input },
        approvalConfig: {
          minRiskForApproval: "high",
          requireApprovalFor: ["update_ticket_status", "create_portal_link", "send_email"],
        },
      });
      if (result.paused && result.decision === "deny") return "deny";
      if (result.paused) return result.decision ?? "approve";
      return null;
    },
    async afterTool(name, toolCallId, output, isError = false) {
      return ingest({
        event: "on_tool_end",
        data: { name, id: toolCallId, output, error: isError || undefined },
      });
    },
  };
}
