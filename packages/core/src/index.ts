export type {
  AgentEvent,
  AgentEventType,
  AgentRunLog,
  ApprovalDecision,
  ApprovalRequestEvent,
  ApprovalResponseEvent,
  BaseEvent,
  ErrorEvent,
  PendingApproval,
  ReasoningEvent,
  RiskLevel,
  RunEndEvent,
  RunStartEvent,
  StateUpdateEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "./schema.js";

export {
  classifyRisk,
  requiresApproval,
  summarizeAction,
  type ApprovalConfig,
} from "./approval.js";

export {
  adaptLangGraphLog,
  adaptLangGraphStreamEvent,
  type LangGraphCheckpoint,
  type LangGraphMessage,
  type LangGraphStreamEvent,
  type LangGraphToolCall,
} from "./adapter/langgraph.js";

export type { AdaptOptions as LangGraphAdaptOptions } from "./adapter/langgraph.js";

export { adaptGenericLog } from "./adapter/generic.js";
export { adaptOpenAILog } from "./adapter/openai.js";
export { adaptVercelAILog } from "./adapter/vercel-ai.js";

export {
  adaptRunLog,
  detectAdapter,
  listAdapters,
  type DetectedAdapter,
} from "./adapter/index.js";

export type {
  AdapterId,
  AdapterResult,
  AdaptOptions,
} from "./adapter/types.js";

export { resetAdapterIds } from "./adapter/utils.js";

export { MOCK_RUN } from "./mock.js";

/** Get the latest unresolved approval request from an event list */
export function getPendingApproval(
  events: import("./schema.js").AgentEvent[]
): import("./schema.js").PendingApproval | null {
  const responded = new Set<string>();
  for (const e of events) {
    if (e.type === "approval_response") {
      responded.add(e.data.toolCallId);
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === "approval_request" && !responded.has(e.data.toolCallId)) {
      return {
        eventId: e.id,
        toolCallId: e.data.toolCallId,
        toolName: e.data.toolName,
        input: e.data.input,
        riskLevel: e.data.riskLevel,
        actionSummary: e.data.actionSummary,
        resource: e.data.resource,
        requestedAt: e.timestamp,
      };
    }
  }
  return null;
}
