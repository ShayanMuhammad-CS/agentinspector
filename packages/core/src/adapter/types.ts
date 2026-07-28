import type { ApprovalConfig } from "../approval.js";
import type { AgentRunLog } from "../schema.js";

export type AdapterId =
  | "auto"
  | "generic"
  | "langgraph"
  | "openai"
  | "vercel-ai";

export interface AdaptOptions {
  runId?: string;
  agentName?: string;
  approvalConfig?: ApprovalConfig;
  /** When true, emit approval_request events for gated tool calls */
  emitApprovalRequests?: boolean;
  now?: () => Date;
}

export interface AdapterResult {
  log: AgentRunLog;
  adapter: Exclude<AdapterId, "auto">;
}
