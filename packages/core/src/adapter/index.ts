import { adaptGenericLog } from "./generic.js";
import { adaptLangGraphLog } from "./langgraph.js";
import { adaptOpenAILog } from "./openai.js";
import type { AdapterId, AdapterResult, AdaptOptions } from "./types.js";
import { isAgentRunLog } from "./utils.js";
import { adaptVercelAILog } from "./vercel-ai.js";

const ADAPTERS = ["generic", "langgraph", "openai", "vercel-ai"] as const;

export type DetectedAdapter = (typeof ADAPTERS)[number];

export function listAdapters(): AdapterId[] {
  return ["auto", ...ADAPTERS];
}

/**
 * Heuristic format detection for --adapter auto.
 */
export function detectAdapter(raw: unknown): DetectedAdapter {
  if (isAgentRunLog(raw) || (Array.isArray(raw) && raw[0] && typeof raw[0] === "object" && "type" in (raw[0] as object) && "stepIndex" in (raw[0] as object))) {
    return "generic";
  }

  if (!raw || typeof raw !== "object") {
    return "langgraph";
  }

  const obj = raw as Record<string, unknown>;
  const hint = String(
    obj.adapter ?? obj.framework ?? obj.provider ?? obj.source ?? ""
  ).toLowerCase();

  if (hint.includes("vercel") || hint === "ai-sdk" || hint === "ai") return "vercel-ai";
  if (hint.includes("openai") || hint.includes("agents-sdk")) return "openai";
  if (hint.includes("langgraph") || hint.includes("langchain")) return "langgraph";
  if (hint === "generic" || hint === "agent-inspector") return "generic";

  if (Array.isArray(obj.steps)) return "vercel-ai";
  if (Array.isArray(obj.output)) return "openai";

  if (Array.isArray(obj.messages) && obj.messages[0] && typeof obj.messages[0] === "object") {
    const m = obj.messages[0] as Record<string, unknown>;
    if (m.type === "human" || m.type === "ai" || m.type === "tool") return "langgraph";
    if (Array.isArray(m.parts)) return "vercel-ai";
    if (Array.isArray(m.content)) {
      const part = m.content[0];
      if (part && typeof part === "object" && "type" in part) {
        const t = String((part as { type: unknown }).type);
        if (t === "tool-call" || t === "text" || t === "tool-result") return "vercel-ai";
      }
    }
    if (m.role === "assistant" || m.role === "user" || m.role === "tool") {
      // Prefer openai when classic tool_calls.function shape appears anywhere
      const hasOpenAITools = obj.messages.some((msg) => {
        if (!msg || typeof msg !== "object") return false;
        const toolCalls = (msg as { tool_calls?: unknown }).tool_calls;
        if (!Array.isArray(toolCalls) || !toolCalls[0] || typeof toolCalls[0] !== "object") {
          return false;
        }
        return "function" in (toolCalls[0] as object);
      });
      if (hasOpenAITools) return "openai";
      if (m.role) return "openai";
    }
  }

  if (Array.isArray(obj.channel_values) || obj.values || obj.checkpoint) {
    return "langgraph";
  }

  // Default: LangGraph adapter is the most forgiving for message dumps
  return "langgraph";
}

export function adaptRunLog(
  raw: unknown,
  options: AdaptOptions & { adapter?: AdapterId } = {}
): AdapterResult {
  const requested = options.adapter ?? "auto";
  const adapter: DetectedAdapter =
    requested === "auto" ? detectAdapter(raw) : (requested as DetectedAdapter);

  const opts: AdaptOptions = {
    ...options,
    emitApprovalRequests: options.emitApprovalRequests ?? true,
  };

  switch (adapter) {
    case "generic":
      return { adapter, log: adaptGenericLog(raw, opts) };
    case "openai":
      return { adapter, log: adaptOpenAILog(raw, opts) };
    case "vercel-ai":
      return { adapter, log: adaptVercelAILog(raw, opts) };
    case "langgraph":
    default:
      return { adapter: "langgraph", log: adaptLangGraphLog(raw, opts) };
  }
}
