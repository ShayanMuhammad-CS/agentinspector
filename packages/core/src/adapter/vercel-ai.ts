import type { AgentEvent } from "../schema.js";
import type { AdaptOptions } from "./types.js";
import {
  iso,
  nextId,
  parseArgs,
  pushReasoning,
  pushToolCall,
  pushToolResult,
  resolveRunId,
  textFromContent,
  wrapRun,
} from "./utils.js";

/**
 * Vercel AI SDK–style logs.
 *
 * Accepted shapes:
 * - { messages: UIMessage[] } with content parts: text | tool-call | tool-result
 * - { steps: [{ text?, toolCalls?, toolResults? }] }
 * - { framework: "vercel-ai", ... }
 */
export function adaptVercelAILog(
  raw: unknown,
  options: AdaptOptions = {}
): ReturnType<typeof wrapRun> {
  const now = options.now ?? (() => new Date());
  const runId = resolveRunId(raw, options.runId ?? nextId("run"));
  const startedAt = iso(now);
  const events: AgentEvent[] = [];
  let step = 0;
  const emit = options.emitApprovalRequests !== false;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  if (Array.isArray(obj.steps)) {
    step = adaptSteps(events, obj.steps, runId, step, now, options, emit);
  } else {
    const messages = Array.isArray(obj.messages)
      ? obj.messages
      : Array.isArray(raw)
        ? raw
        : [];
    step = adaptMessages(events, messages, runId, step, now, options, emit);
  }

  return wrapRun(events, {
    ...options,
    runId,
    agentName: options.agentName ?? "vercel-ai-agent",
    startedAt,
    now,
  });
}

function adaptMessages(
  events: AgentEvent[],
  messages: unknown[],
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions,
  emit: boolean
): number {
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const role = String(m.role ?? "").toLowerCase();

    if (role === "user" || role === "system") {
      const text = textFromContent(m.content);
      if (text) {
        step = pushReasoning(events, {
          runId,
          step,
          now,
          content: role === "user" ? `[user] ${text}` : `[system] ${text}`,
        });
      }
      continue;
    }

    // Assistant with string or parts
    if (role === "assistant") {
      if (typeof m.content === "string") {
        step = pushReasoning(events, { runId, step, now, content: m.content });
      } else if (Array.isArray(m.content)) {
        step = adaptParts(events, m.content, runId, step, now, options, emit);
      } else if (Array.isArray(m.parts)) {
        step = adaptParts(events, m.parts, runId, step, now, options, emit);
      }

      // Some SDK versions put toolCalls on the message
      if (Array.isArray(m.toolInvocations)) {
        for (const inv of m.toolInvocations) {
          step = adaptInvocation(events, inv, runId, step, now, options, emit);
        }
      }
      continue;
    }

    if (role === "tool") {
      if (Array.isArray(m.content)) {
        step = adaptParts(events, m.content, runId, step, now, options, emit);
      } else {
        step = pushToolResult(events, {
          runId,
          step,
          now,
          toolName: String(m.toolName ?? m.name ?? "tool"),
          toolCallId: String(m.toolCallId ?? m.tool_call_id ?? nextId("tc")),
          output: parseArgs(m.result ?? m.content),
        });
      }
    }
  }
  return step;
}

function adaptParts(
  events: AgentEvent[],
  parts: unknown[],
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions,
  emit: boolean
): number {
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = String(p.type ?? "");

    if (type === "text") {
      step = pushReasoning(events, {
        runId,
        step,
        now,
        content: String(p.text ?? ""),
      });
      continue;
    }

    if (type === "tool-call" || type === "tool_call") {
      step = pushToolCall(events, {
        runId,
        step,
        now,
        toolName: String(p.toolName ?? p.name ?? "tool"),
        toolCallId: String(p.toolCallId ?? p.id ?? nextId("tc")),
        input: parseArgs(p.args ?? p.input ?? {}),
        approvalConfig: options.approvalConfig,
        emitApprovalRequests: emit,
      });
      continue;
    }

    if (type === "tool-result" || type === "tool_result") {
      step = pushToolResult(events, {
        runId,
        step,
        now,
        toolName: String(p.toolName ?? p.name ?? "tool"),
        toolCallId: String(p.toolCallId ?? p.id ?? nextId("tc")),
        output: parseArgs(p.result ?? p.output ?? p.content),
        isError: Boolean(p.isError),
      });
    }
  }
  return step;
}

function adaptInvocation(
  events: AgentEvent[],
  inv: unknown,
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions,
  emit: boolean
): number {
  if (!inv || typeof inv !== "object") return step;
  const i = inv as Record<string, unknown>;
  const name = String(i.toolName ?? i.name ?? "tool");
  const id = String(i.toolCallId ?? i.id ?? nextId("tc"));
  step = pushToolCall(events, {
    runId,
    step,
    now,
    toolName: name,
    toolCallId: id,
    input: parseArgs(i.args ?? {}),
    approvalConfig: options.approvalConfig,
    emitApprovalRequests: emit,
  });
  if ("result" in i) {
    step = pushToolResult(events, {
      runId,
      step,
      now,
      toolName: name,
      toolCallId: id,
      output: parseArgs(i.result),
    });
  }
  return step;
}

function adaptSteps(
  events: AgentEvent[],
  steps: unknown[],
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions,
  emit: boolean
): number {
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const st = s as Record<string, unknown>;
    if (typeof st.text === "string" && st.text.trim()) {
      step = pushReasoning(events, { runId, step, now, content: st.text });
    }
    const toolCalls = Array.isArray(st.toolCalls) ? st.toolCalls : [];
    for (const tc of toolCalls) {
      if (!tc || typeof tc !== "object") continue;
      const c = tc as Record<string, unknown>;
      step = pushToolCall(events, {
        runId,
        step,
        now,
        toolName: String(c.toolName ?? c.name ?? "tool"),
        toolCallId: String(c.toolCallId ?? c.id ?? nextId("tc")),
        input: parseArgs(c.args ?? {}),
        approvalConfig: options.approvalConfig,
        emitApprovalRequests: emit,
      });
    }
    const toolResults = Array.isArray(st.toolResults) ? st.toolResults : [];
    for (const tr of toolResults) {
      if (!tr || typeof tr !== "object") continue;
      const r = tr as Record<string, unknown>;
      step = pushToolResult(events, {
        runId,
        step,
        now,
        toolName: String(r.toolName ?? r.name ?? "tool"),
        toolCallId: String(r.toolCallId ?? r.id ?? nextId("tc")),
        output: parseArgs(r.result ?? r.output),
      });
    }
  }
  return step;
}
