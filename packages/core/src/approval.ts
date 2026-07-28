import type { RiskLevel } from "./schema.js";

/**
 * Heuristic risk classification for common tool names.
 * Override via ApprovalConfig.riskOverrides.
 */
const DEFAULT_RISK_PATTERNS: Array<{ pattern: RegExp; level: RiskLevel }> = [
  { pattern: /^(delete|remove|rm|unlink|drop)/i, level: "critical" },
  { pattern: /^(send|email|slack|notify|post_message|tweet)/i, level: "high" },
  { pattern: /^(write|create|update|put|patch|insert|upload|execute|run|shell|bash|eval)/i, level: "high" },
  { pattern: /^(http|fetch|request|api_call|webhook)/i, level: "medium" },
  { pattern: /^(read|get|list|search|query|find|lookup|browse)/i, level: "low" },
];

export function classifyRisk(
  toolName: string,
  overrides?: Record<string, RiskLevel>
): RiskLevel {
  if (overrides?.[toolName]) {
    return overrides[toolName];
  }
  for (const { pattern, level } of DEFAULT_RISK_PATTERNS) {
    if (pattern.test(toolName)) {
      return level;
    }
  }
  return "medium";
}

export interface ApprovalConfig {
  /**
   * Tool names (exact or RegExp source strings) that always require approval.
   * Empty array = use risk threshold only.
   */
  requireApprovalFor?: Array<string | RegExp>;
  /**
   * Tools at or above this risk level require approval.
   * Default: "high"
   */
  minRiskForApproval?: RiskLevel;
  /** Per-tool risk overrides */
  riskOverrides?: Record<string, RiskLevel>;
  /** Tools that never require approval (allowlist) */
  alwaysAllow?: string[];
}

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function requiresApproval(
  toolName: string,
  config: ApprovalConfig = {}
): boolean {
  if (config.alwaysAllow?.includes(toolName)) {
    return false;
  }

  const risk = classifyRisk(toolName, config.riskOverrides);
  const minRisk = config.minRiskForApproval ?? "high";

  if (RISK_ORDER[risk] >= RISK_ORDER[minRisk]) {
    return true;
  }

  for (const rule of config.requireApprovalFor ?? []) {
    if (typeof rule === "string") {
      if (rule === toolName) return true;
    } else if (rule.test(toolName)) {
      return true;
    }
  }

  return false;
}

/** Build a short human-readable action summary for the approval card */
export function summarizeAction(
  toolName: string,
  input: unknown
): { actionSummary: string; resource?: string } {
  const resource = extractResource(input);
  const verb = humanizeToolName(toolName);

  if (resource) {
    return {
      actionSummary: `${verb} on ${resource}`,
      resource,
    };
  }

  return {
    actionSummary: `${verb}${formatInputBrief(input)}`,
  };
}

function humanizeToolName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

function extractResource(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const keys = [
    "path",
    "file",
    "filename",
    "url",
    "uri",
    "resource",
    "table",
    "channel",
    "to",
    "recipient",
    "id",
  ];
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0 && val.length < 200) {
      return val;
    }
  }
  return undefined;
}

function formatInputBrief(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") {
    return input.length > 60 ? `: "${input.slice(0, 57)}…"` : `: "${input}"`;
  }
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? `: ${s.slice(0, 77)}…` : `: ${s}`;
  } catch {
    return "";
  }
}
