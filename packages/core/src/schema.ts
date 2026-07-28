/**
 * Internal event schema for Agent Action Inspector.
 * All adapters (LangGraph, future frameworks) map into this shape.
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type AgentEventType =
  | "run_start"
  | "run_end"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "state_update"
  | "approval_request"
  | "approval_response"
  | "error";

export interface BaseEvent {
  /** Stable unique id for this event */
  id: string;
  type: AgentEventType;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Groups events belonging to one agent run */
  runId: string;
  /** Monotonic step index within the run (0-based) */
  stepIndex: number;
}

export interface RunStartEvent extends BaseEvent {
  type: "run_start";
  data: {
    agentName?: string;
    threadId?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface RunEndEvent extends BaseEvent {
  type: "run_end";
  data: {
    status: "success" | "error" | "cancelled" | "denied";
    summary?: string;
  };
}

export interface ReasoningEvent extends BaseEvent {
  type: "reasoning";
  data: {
    content: string;
    model?: string;
  };
}

export interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  data: {
    toolName: string;
    toolCallId: string;
    input: unknown;
    riskLevel: RiskLevel;
    /** True when this call is gated behind human approval */
    requiresApproval: boolean;
  };
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  data: {
    toolName: string;
    toolCallId: string;
    output: unknown;
    durationMs?: number;
    isError?: boolean;
  };
}

export interface StateUpdateEvent extends BaseEvent {
  type: "state_update";
  data: {
    path?: string;
    before?: unknown;
    after?: unknown;
    summary?: string;
  };
}

export interface ApprovalRequestEvent extends BaseEvent {
  type: "approval_request";
  data: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    riskLevel: RiskLevel;
    /** Human-readable summary, e.g. "delete file /tmp/data.json" */
    actionSummary: string;
    resource?: string;
  };
}

export interface ApprovalResponseEvent extends BaseEvent {
  type: "approval_response";
  data: {
    toolCallId: string;
    decision: "approve" | "deny";
    decidedAt: string;
    decidedBy?: string;
  };
}

export interface ErrorEvent extends BaseEvent {
  type: "error";
  data: {
    message: string;
    stack?: string;
    recoverable?: boolean;
  };
}

export type AgentEvent =
  | RunStartEvent
  | RunEndEvent
  | ReasoningEvent
  | ToolCallEvent
  | ToolResultEvent
  | StateUpdateEvent
  | ApprovalRequestEvent
  | ApprovalResponseEvent
  | ErrorEvent;

/** A complete recorded run (file-mode / session replay) */
export interface AgentRunLog {
  version: 1;
  runId: string;
  agentName?: string;
  startedAt: string;
  endedAt?: string;
  events: AgentEvent[];
}

/** Pending approval waiting on a human decision */
export interface PendingApproval {
  eventId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  riskLevel: RiskLevel;
  actionSummary: string;
  resource?: string;
  requestedAt: string;
}

export type ApprovalDecision = "approve" | "deny";
