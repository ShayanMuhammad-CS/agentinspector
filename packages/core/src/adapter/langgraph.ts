import {
  classifyRisk,
  requiresApproval,
  summarizeAction,
  type ApprovalConfig,
} from "../approval.js";
import type {
  AgentEvent,
  AgentRunLog,
  ApprovalRequestEvent,
  ReasoningEvent,
  RiskLevel,
  RunEndEvent,
  RunStartEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "../schema.js";

/**
 * Subset of LangGraph / LangChain stream + checkpoint shapes we accept.
 * Kept intentionally loose — real payloads vary by version.
 */

export interface LangGraphMessage {
  type?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  id?: string;
  tool_calls?: LangGraphToolCall[];
  name?: string;
  tool_call_id?: string;
}

export interface LangGraphToolCall {
  id?: string;
  name: string;
  args?: unknown;
  arguments?: unknown;
}

export interface LangGraphStreamEvent {
  event?: string;
  name?: string;
  data?: unknown;
  // alternate shapes from astream_events / custom serializers
  type?: string;
  payload?: unknown;
}

export interface LangGraphCheckpoint {
  id?: string;
  ts?: string;
  channel_values?: {
    messages?: LangGraphMessage[];
    [key: string]: unknown;
  };
  values?: {
    messages?: LangGraphMessage[];
    [key: string]: unknown;
  };
}

export interface AdaptOptions {
  runId?: string;
  agentName?: string;
  approvalConfig?: ApprovalConfig;
  /** When true, emit approval_request events for gated tool calls */
  emitApprovalRequests?: boolean;
  now?: () => Date;
}

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function textFromContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c.text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function toolInput(tc: LangGraphToolCall): unknown {
  if (tc.args !== undefined) return tc.args;
  if (typeof tc.arguments === "string") {
    try {
      return JSON.parse(tc.arguments);
    } catch {
      return tc.arguments;
    }
  }
  return tc.arguments ?? {};
}

/**
 * Convert a static LangGraph-style log (messages array or checkpoint dump)
 * into our AgentRunLog. Used for file-mode session replay.
 */
export function adaptLangGraphLog(
  raw: unknown,
  options: AdaptOptions = {}
): AgentRunLog {
  const now = options.now ?? (() => new Date());
  const runId =
    options.runId ??
    (typeof raw === "object" &&
    raw &&
    "runId" in raw &&
    typeof (raw as { runId: unknown }).runId === "string"
      ? (raw as { runId: string }).runId
      : nextId("run"));

  // Already in our schema?
  if (isAgentRunLog(raw)) {
    return enrichApprovals(raw, options);
  }

  const events: AgentEvent[] = [];
  let step = 0;
  const startedAt = iso(now);

  events.push({
    id: nextId("evt"),
    type: "run_start",
    timestamp: startedAt,
    runId,
    stepIndex: step++,
    data: {
      agentName: options.agentName,
      metadata: typeof raw === "object" && raw ? { source: "langgraph" } : {},
    },
  } satisfies RunStartEvent);

  const messages = extractMessages(raw);
  for (const msg of messages) {
    const role = (msg.type ?? msg.role ?? "").toLowerCase();

    if (role === "ai" || role === "assistant" || role === "aimessage") {
      const text = textFromContent(msg.content);
      if (text.trim()) {
        events.push({
          id: nextId("evt"),
          type: "reasoning",
          timestamp: iso(now),
          runId,
          stepIndex: step++,
          data: { content: text },
        } satisfies ReasoningEvent);
      }
      for (const tc of msg.tool_calls ?? []) {
        step = pushToolCall(events, tc, runId, step, now, options);
      }
    } else if (role === "tool" || role === "toolmessage") {
      events.push({
        id: nextId("evt"),
        type: "tool_result",
        timestamp: iso(now),
        runId,
        stepIndex: step++,
        data: {
          toolName: msg.name ?? "tool",
          toolCallId: msg.tool_call_id ?? nextId("tc"),
          output: textFromContent(msg.content) || msg.content,
        },
      } satisfies ToolResultEvent);
    } else if (role === "human" || role === "user" || role === "humanmessage") {
      const text = textFromContent(msg.content);
      if (text.trim()) {
        events.push({
          id: nextId("evt"),
          type: "reasoning",
          timestamp: iso(now),
          runId,
          stepIndex: step++,
          data: { content: `[user] ${text}` },
        } satisfies ReasoningEvent);
      }
    }
  }

  // Also accept pre-serialized stream events
  const streamEvents = extractStreamEvents(raw);
  for (const se of streamEvents) {
    step = adaptStreamEventInto(events, se, runId, step, now, options);
  }

  events.push({
    id: nextId("evt"),
    type: "run_end",
    timestamp: iso(now),
    runId,
    stepIndex: step++,
    data: { status: "success" },
  } satisfies RunEndEvent);

  return {
    version: 1,
    runId,
    agentName: options.agentName,
    startedAt,
    endedAt: iso(now),
    events,
  };
}

/**
 * Map a single live LangGraph astream_events / custom SSE payload
 * into zero or more AgentEvents.
 */
export function adaptLangGraphStreamEvent(
  raw: LangGraphStreamEvent | unknown,
  ctx: {
    runId: string;
    stepIndex: number;
    approvalConfig?: ApprovalConfig;
    emitApprovalRequests?: boolean;
    now?: () => Date;
  }
): { events: AgentEvent[]; nextStepIndex: number } {
  const now = ctx.now ?? (() => new Date());
  const events: AgentEvent[] = [];
  let step = ctx.stepIndex;
  step = adaptStreamEventInto(
    events,
    normalizeStreamEvent(raw),
    ctx.runId,
    step,
    now,
    {
      approvalConfig: ctx.approvalConfig,
      emitApprovalRequests: ctx.emitApprovalRequests ?? true,
      now,
    }
  );
  return { events, nextStepIndex: step };
}

function adaptStreamEventInto(
  events: AgentEvent[],
  se: LangGraphStreamEvent,
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions
): number {
  const eventName = (se.event ?? se.type ?? se.name ?? "").toLowerCase();
  const data = (se.data ?? se.payload ?? {}) as Record<string, unknown>;

  // on_chat_model_stream / on_chat_model_end with reasoning
  if (
    eventName.includes("chat_model") ||
    eventName.includes("llm") ||
    eventName === "reasoning"
  ) {
    const chunk = data.chunk as LangGraphMessage | undefined;
    const output = data.output as LangGraphMessage | undefined;
    const msg = output ?? chunk;
    const text =
      textFromContent(msg?.content) ||
      (typeof data.content === "string" ? data.content : "");
    if (text.trim() && !eventName.includes("stream")) {
      events.push({
        id: nextId("evt"),
        type: "reasoning",
        timestamp: iso(now),
        runId,
        stepIndex: step++,
        data: { content: text },
      } satisfies ReasoningEvent);
    }
    const toolCalls = msg?.tool_calls ?? (data.tool_calls as LangGraphToolCall[] | undefined);
    if (toolCalls) {
      for (const tc of toolCalls) {
        step = pushToolCall(events, tc, runId, step, now, options);
      }
    }
    return step;
  }

  if (eventName.includes("tool_start") || eventName === "tool_call") {
    const name = String(data.name ?? data.tool ?? "tool");
    const tc: LangGraphToolCall = {
      id: String(data.id ?? data.tool_call_id ?? nextId("tc")),
      name,
      args: data.input ?? data.args,
    };
    return pushToolCall(events, tc, runId, step, now, options);
  }

  if (eventName.includes("tool_end") || eventName === "tool_result") {
    events.push({
      id: nextId("evt"),
      type: "tool_result",
      timestamp: iso(now),
      runId,
      stepIndex: step++,
      data: {
        toolName: String(data.name ?? data.tool ?? "tool"),
        toolCallId: String(data.id ?? data.tool_call_id ?? nextId("tc")),
        output: data.output ?? data.content ?? data,
        isError: Boolean(data.error),
      },
    } satisfies ToolResultEvent);
    return step;
  }

  if (eventName === "error") {
    events.push({
      id: nextId("evt"),
      type: "error",
      timestamp: iso(now),
      runId,
      stepIndex: step++,
      data: {
        message: String(data.message ?? data.error ?? "Unknown error"),
        stack: typeof data.stack === "string" ? data.stack : undefined,
      },
    });
  }

  return step;
}

function pushToolCall(
  events: AgentEvent[],
  tc: LangGraphToolCall,
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions
): number {
  const input = toolInput(tc);
  const risk: RiskLevel = classifyRisk(
    tc.name,
    options.approvalConfig?.riskOverrides
  );
  const needsApproval = requiresApproval(tc.name, options.approvalConfig);
  const toolCallId = tc.id ?? nextId("tc");

  events.push({
    id: nextId("evt"),
    type: "tool_call",
    timestamp: iso(now),
    runId,
    stepIndex: step++,
    data: {
      toolName: tc.name,
      toolCallId,
      input,
      riskLevel: risk,
      requiresApproval: needsApproval,
    },
  } satisfies ToolCallEvent);

  if (needsApproval && options.emitApprovalRequests) {
    const { actionSummary, resource } = summarizeAction(tc.name, input);
    events.push({
      id: nextId("evt"),
      type: "approval_request",
      timestamp: iso(now),
      runId,
      stepIndex: step++,
      data: {
        toolCallId,
        toolName: tc.name,
        input,
        riskLevel: risk,
        actionSummary,
        resource,
      },
    } satisfies ApprovalRequestEvent);
  }

  return step;
}

function extractMessages(raw: unknown): LangGraphMessage[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.messages)) return obj.messages as LangGraphMessage[];
  if (Array.isArray(obj)) return obj as LangGraphMessage[];

  const cv = obj.channel_values as Record<string, unknown> | undefined;
  if (cv && Array.isArray(cv.messages)) return cv.messages as LangGraphMessage[];

  const values = obj.values as Record<string, unknown> | undefined;
  if (values && Array.isArray(values.messages))
    return values.messages as LangGraphMessage[];

  const checkpoint = obj.checkpoint as LangGraphCheckpoint | undefined;
  if (checkpoint) {
    return extractMessages(checkpoint);
  }

  return [];
}

function extractStreamEvents(raw: unknown): LangGraphStreamEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.events)) {
    // If already our schema, skip
    if (obj.events[0] && typeof obj.events[0] === "object") {
      const first = obj.events[0] as Record<string, unknown>;
      if (
        first.type === "run_start" ||
        first.type === "reasoning" ||
        first.type === "tool_call"
      ) {
        return [];
      }
    }
    return obj.events as LangGraphStreamEvent[];
  }
  if (Array.isArray(obj.stream)) return obj.stream as LangGraphStreamEvent[];
  return [];
}

function normalizeStreamEvent(raw: unknown): LangGraphStreamEvent {
  if (!raw || typeof raw !== "object") return {};
  return raw as LangGraphStreamEvent;
}

function isAgentRunLog(raw: unknown): raw is AgentRunLog {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as AgentRunLog).version === 1 &&
    Array.isArray((raw as AgentRunLog).events)
  );
}

function enrichApprovals(log: AgentRunLog, options: AdaptOptions): AgentRunLog {
  if (!options.approvalConfig && !options.emitApprovalRequests) {
    return log;
  }
  const events: AgentEvent[] = [];
  for (const evt of log.events) {
    events.push(evt);
    if (evt.type === "tool_call") {
      const needs = requiresApproval(
        evt.data.toolName,
        options.approvalConfig
      );
      if (needs && options.emitApprovalRequests !== false) {
        const already = log.events.some(
          (e) =>
            e.type === "approval_request" &&
            e.data.toolCallId === evt.data.toolCallId
        );
        if (!already) {
          const { actionSummary, resource } = summarizeAction(
            evt.data.toolName,
            evt.data.input
          );
          events.push({
            id: nextId("evt"),
            type: "approval_request",
            timestamp: evt.timestamp,
            runId: evt.runId,
            stepIndex: evt.stepIndex,
            data: {
              toolCallId: evt.data.toolCallId,
              toolName: evt.data.toolName,
              input: evt.data.input,
              riskLevel: evt.data.riskLevel,
              actionSummary,
              resource,
            },
          } satisfies ApprovalRequestEvent);
        }
      }
    }
  }
  return { ...log, events };
}

/** Reset internal id counter (useful in tests) */
export function resetAdapterIds(): void {
  idCounter = 0;
}
