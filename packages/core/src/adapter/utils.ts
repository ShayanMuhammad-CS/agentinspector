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
  RunEndEvent,
  RunStartEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "../schema.js";
import type { AdaptOptions } from "./types.js";

let idCounter = 0;

export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resetAdapterIds(): void {
  idCounter = 0;
}

export function iso(now: () => Date): string {
  return now().toISOString();
}

export function isAgentRunLog(raw: unknown): raw is AgentRunLog {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as AgentRunLog).version === 1 &&
    Array.isArray((raw as AgentRunLog).events)
  );
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const o = c as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
          if (typeof o.content === "string") return o.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
  }
  return "";
}

export function parseArgs(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw ?? {};
}

export function pushToolCall(
  events: AgentEvent[],
  opts: {
    runId: string;
    step: number;
    now: () => Date;
    toolName: string;
    toolCallId: string;
    input: unknown;
    approvalConfig?: ApprovalConfig;
    emitApprovalRequests?: boolean;
  }
): number {
  let step = opts.step;
  const risk = classifyRisk(opts.toolName, opts.approvalConfig?.riskOverrides);
  const needsApproval = requiresApproval(opts.toolName, opts.approvalConfig);

  events.push({
    id: nextId("evt"),
    type: "tool_call",
    timestamp: iso(opts.now),
    runId: opts.runId,
    stepIndex: step++,
    data: {
      toolName: opts.toolName,
      toolCallId: opts.toolCallId,
      input: opts.input,
      riskLevel: risk,
      requiresApproval: needsApproval,
    },
  } satisfies ToolCallEvent);

  if (needsApproval && opts.emitApprovalRequests !== false) {
    const { actionSummary, resource } = summarizeAction(opts.toolName, opts.input);
    events.push({
      id: nextId("evt"),
      type: "approval_request",
      timestamp: iso(opts.now),
      runId: opts.runId,
      stepIndex: step++,
      data: {
        toolCallId: opts.toolCallId,
        toolName: opts.toolName,
        input: opts.input,
        riskLevel: risk,
        actionSummary,
        resource,
      },
    } satisfies ApprovalRequestEvent);
  }

  return step;
}

export function pushToolResult(
  events: AgentEvent[],
  opts: {
    runId: string;
    step: number;
    now: () => Date;
    toolName: string;
    toolCallId: string;
    output: unknown;
    isError?: boolean;
  }
): number {
  events.push({
    id: nextId("evt"),
    type: "tool_result",
    timestamp: iso(opts.now),
    runId: opts.runId,
    stepIndex: opts.step,
    data: {
      toolName: opts.toolName,
      toolCallId: opts.toolCallId,
      output: opts.output,
      isError: opts.isError,
    },
  } satisfies ToolResultEvent);
  return opts.step + 1;
}

export function pushReasoning(
  events: AgentEvent[],
  opts: {
    runId: string;
    step: number;
    now: () => Date;
    content: string;
  }
): number {
  if (!opts.content.trim()) return opts.step;
  events.push({
    id: nextId("evt"),
    type: "reasoning",
    timestamp: iso(opts.now),
    runId: opts.runId,
    stepIndex: opts.step,
    data: { content: opts.content },
  } satisfies ReasoningEvent);
  return opts.step + 1;
}

export function wrapRun(
  events: AgentEvent[],
  opts: AdaptOptions & { runId: string; startedAt: string }
): AgentRunLog {
  const now = opts.now ?? (() => new Date());
  const bookended: AgentEvent[] = [];
  const hasStart = events.some((e) => e.type === "run_start");
  const hasEnd = events.some((e) => e.type === "run_end");
  let step = 0;

  if (!hasStart) {
    bookended.push({
      id: nextId("evt"),
      type: "run_start",
      timestamp: opts.startedAt,
      runId: opts.runId,
      stepIndex: step++,
      data: { agentName: opts.agentName },
    } satisfies RunStartEvent);
  }

  for (const e of events) {
    bookended.push({ ...e, stepIndex: hasStart ? e.stepIndex : step++ });
  }

  if (!hasEnd) {
    bookended.push({
      id: nextId("evt"),
      type: "run_end",
      timestamp: iso(now),
      runId: opts.runId,
      stepIndex: step++,
      data: { status: "success" },
    } satisfies RunEndEvent);
  }

  return {
    version: 1,
    runId: opts.runId,
    agentName: opts.agentName,
    startedAt: opts.startedAt,
    endedAt: iso(now),
    events: bookended,
  };
}

export function enrichApprovals(log: AgentRunLog, options: AdaptOptions): AgentRunLog {
  if (options.emitApprovalRequests === false) return log;
  const events: AgentEvent[] = [];
  for (const evt of log.events) {
    events.push(evt);
    if (evt.type !== "tool_call") continue;
    if (!requiresApproval(evt.data.toolName, options.approvalConfig)) continue;
    const already = log.events.some(
      (e) =>
        e.type === "approval_request" && e.data.toolCallId === evt.data.toolCallId
    );
    if (already) continue;
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
  return { ...log, events };
}

export function resolveRunId(raw: unknown, fallback: string): string {
  if (raw && typeof raw === "object" && "runId" in raw) {
    const id = (raw as { runId: unknown }).runId;
    if (typeof id === "string" && id) return id;
  }
  return fallback;
}
