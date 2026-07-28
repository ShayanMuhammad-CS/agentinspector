import type { AdaptOptions } from "./types.js";
import { enrichApprovals, isAgentRunLog, nextId } from "./utils.js";
import type { AgentRunLog } from "../schema.js";

/**
 * Native Agent Action Inspector log (version: 1, events: [...]).
 * Also accepts a bare events array.
 */
export function adaptGenericLog(
  raw: unknown,
  options: AdaptOptions = {}
): AgentRunLog {
  if (isAgentRunLog(raw)) {
    return enrichApprovals(
      {
        ...raw,
        agentName: options.agentName ?? raw.agentName,
        runId: options.runId ?? raw.runId,
      },
      options
    );
  }

  if (Array.isArray(raw)) {
    const runId = options.runId ?? nextId("run");
    const startedAt =
      (raw[0] &&
      typeof raw[0] === "object" &&
      "timestamp" in raw[0] &&
      typeof (raw[0] as { timestamp: unknown }).timestamp === "string"
        ? (raw[0] as { timestamp: string }).timestamp
        : new Date().toISOString());
    return enrichApprovals(
      {
        version: 1,
        runId,
        agentName: options.agentName,
        startedAt,
        events: raw as AgentRunLog["events"],
      },
      options
    );
  }

  throw new Error(
    "Generic adapter expects { version: 1, events: [...] } or an events array"
  );
}
