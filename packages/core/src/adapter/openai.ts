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
 * OpenAI Chat Completions / Assistants / Agents SDK–style logs.
 *
 * Accepted shapes:
 * - { messages: [{ role, content, tool_calls?, tool_call_id? }] }
 * - { output: [{ type: "message"|"function_call"|"function_call_output", ... }] }  (Responses API)
 * - { provider: "openai" | "openai-agents", ... }
 */
export function adaptOpenAILog(raw: unknown, options: AdaptOptions = {}): ReturnType<typeof wrapRun> {
  const now = options.now ?? (() => new Date());
  const runId = resolveRunId(raw, options.runId ?? nextId("run"));
  const startedAt = iso(now);
  const events: AgentEvent[] = [];
  let step = 0;
  const emit = options.emitApprovalRequests !== false;

  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  if (Array.isArray(obj.output)) {
    step = adaptResponsesOutput(events, obj.output, runId, step, now, options, emit);
  } else {
    const messages = Array.isArray(obj.messages)
      ? obj.messages
      : Array.isArray(raw)
        ? raw
        : [];
    step = adaptChatMessages(events, messages, runId, step, now, options, emit);
  }

  return wrapRun(events, {
    ...options,
    runId,
    agentName: options.agentName ?? "openai-agent",
    startedAt,
    now,
  });
}

function adaptChatMessages(
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

    if (role === "assistant") {
      const text = textFromContent(m.content);
      if (text) step = pushReasoning(events, { runId, step, now, content: text });

      const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") continue;
        const call = tc as Record<string, unknown>;
        const fn =
          call.function && typeof call.function === "object"
            ? (call.function as Record<string, unknown>)
            : call;
        const name = String(fn.name ?? call.name ?? "tool");
        const id = String(call.id ?? nextId("tc"));
        const input = parseArgs(fn.arguments ?? call.arguments ?? call.input ?? {});
        step = pushToolCall(events, {
          runId,
          step,
          now,
          toolName: name,
          toolCallId: id,
          input,
          approvalConfig: options.approvalConfig,
          emitApprovalRequests: emit,
        });
      }
      continue;
    }

    if (role === "tool" || role === "function") {
      step = pushToolResult(events, {
        runId,
        step,
        now,
        toolName: String(m.name ?? "tool"),
        toolCallId: String(m.tool_call_id ?? m.toolCallId ?? nextId("tc")),
        output: parseArgs(m.content ?? m.output),
      });
    }
  }
  return step;
}

function adaptResponsesOutput(
  events: AgentEvent[],
  output: unknown[],
  runId: string,
  step: number,
  now: () => Date,
  options: AdaptOptions,
  emit: boolean
): number {
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = String(o.type ?? "");

    if (type === "message" || type === "output_text") {
      const text = textFromContent(o.content ?? o.text);
      if (text) step = pushReasoning(events, { runId, step, now, content: text });
      continue;
    }

    if (type === "function_call" || type === "custom_tool_call") {
      const name = String(o.name ?? "tool");
      const id = String(o.call_id ?? o.id ?? nextId("tc"));
      const input = parseArgs(o.arguments ?? o.input ?? {});
      step = pushToolCall(events, {
        runId,
        step,
        now,
        toolName: name,
        toolCallId: id,
        input,
        approvalConfig: options.approvalConfig,
        emitApprovalRequests: emit,
      });
      continue;
    }

    if (type === "function_call_output" || type === "custom_tool_call_output") {
      step = pushToolResult(events, {
        runId,
        step,
        now,
        toolName: String(o.name ?? "tool"),
        toolCallId: String(o.call_id ?? o.id ?? nextId("tc")),
        output: parseArgs(o.output ?? o.content),
      });
    }
  }
  return step;
}
