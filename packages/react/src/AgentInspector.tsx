"use client";

import type { AgentEvent, AgentRunLog } from "@agent-inspector/core";
import { getPendingApproval } from "@agent-inspector/core";
import { useEffect } from "react";
import { ApprovalCard } from "./components/ApprovalCard.js";
import { Timeline } from "./components/Timeline.js";
import {
  type InspectorMode,
  type OnApprovalHandler,
  useInspectorStore,
} from "./store.js";

export interface AgentInspectorProps {
  /** Static run log (file / replay mode) */
  log?: AgentRunLog | AgentEvent[];
  /** Live events — when provided, overrides log and sets live mode */
  events?: AgentEvent[];
  mode?: InspectorMode;
  agentName?: string;
  className?: string;
  /** Called when the operator approves or denies a gated tool call */
  onApproval?: OnApprovalHandler;
  /** Hide the side approval panel even if a request is pending */
  hideApprovalPanel?: boolean;
  /** Show brand header (default true) */
  showHeader?: boolean;
}

function normalizeEvents(log?: AgentRunLog | AgentEvent[]): AgentEvent[] {
  if (!log) return [];
  return Array.isArray(log) ? log : log.events;
}

export function AgentInspector({
  log,
  events: liveEvents,
  mode,
  agentName,
  className,
  onApproval,
  hideApprovalPanel,
  showHeader = true,
}: AgentInspectorProps) {
  const storeEvents = useInspectorStore((s) => s.events);
  const storeMode = useInspectorStore((s) => s.mode);
  const storeAgent = useInspectorStore((s) => s.agentName);
  const storeRunId = useInspectorStore((s) => s.runId);
  const deciding = useInspectorStore((s) => s.deciding);
  const setLog = useInspectorStore((s) => s.setLog);
  const setDeciding = useInspectorStore((s) => s.setDeciding);

  useEffect(() => {
    if (liveEvents) {
      setLog(liveEvents, {
        mode: mode ?? "live",
        agentName,
        runId: liveEvents[0]?.runId,
      });
      return;
    }
    if (log) {
      const events = normalizeEvents(log);
      const meta = Array.isArray(log)
        ? { mode: mode ?? "replay", agentName, runId: events[0]?.runId }
        : {
            mode: mode ?? "replay",
            agentName: agentName ?? log.agentName,
            runId: log.runId,
          };
      setLog(events, meta);
    }
  }, [log, liveEvents, mode, agentName, setLog]);

  const events = liveEvents ?? storeEvents;
  const effectiveMode = mode ?? (liveEvents ? "live" : storeMode);
  const pending = getPendingApproval(events);
  const unresolved =
    pending &&
    !events.some(
      (e) =>
        e.type === "approval_response" && e.data.toolCallId === pending.toolCallId
    );
  const showApproval = !hideApprovalPanel && unresolved && pending;
  const readOnly = effectiveMode === "replay" || !onApproval;

  const handleDecision: OnApprovalHandler = async (toolCallId, decision) => {
    if (!onApproval) return;
    setDeciding(true);
    try {
      await onApproval(toolCallId, decision);
    } finally {
      setDeciding(false);
    }
  };

  const displayName = agentName ?? storeAgent ?? "Agent run";
  const badgeClass =
    effectiveMode === "live"
      ? unresolved
        ? "ai-badge ai-badge--paused"
        : "ai-badge ai-badge--live"
      : "ai-badge ai-badge--replay";
  const badgeLabel =
    effectiveMode === "live" ? (unresolved ? "Paused · approval" : "Live") : "Replay";

  return (
    <div className={`ai-root ai-inspector${className ? ` ${className}` : ""}`}>
      {showHeader && (
        <header className="ai-header">
          <div className="ai-brand">
            <span className="ai-brand-name">Agent Action Inspector</span>
            <span className="ai-brand-title">{displayName}</span>
          </div>
          <div className="ai-meta">
            <span className={badgeClass}>
              {effectiveMode === "live" && !unresolved && <span className="ai-badge-dot" />}
              {badgeLabel}
            </span>
            {storeRunId && <span title={storeRunId}>{storeRunId.slice(0, 16)}</span>}
            <span>{events.length} events</span>
          </div>
        </header>
      )}
      <div className={`ai-body${showApproval ? " ai-body--with-approval" : ""}`}>
        <div className="ai-timeline-wrap">
          <Timeline events={events} />
        </div>
        {showApproval && pending && (
          <aside className="ai-approval-panel">
            <ApprovalCard
              pending={pending}
              deciding={deciding}
              readOnly={readOnly && effectiveMode === "replay"}
              onDecision={readOnly ? undefined : handleDecision}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

export { Timeline, TimelineStep } from "./components/Timeline.js";
export { ApprovalCard } from "./components/ApprovalCard.js";
export { useInspectorStore } from "./store.js";
export type { InspectorMode, OnApprovalHandler } from "./store.js";
