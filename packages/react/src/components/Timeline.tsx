"use client";

import type { AgentEvent, RiskLevel } from "@kashifmuhammad/agent-inspector-core";
import { useInspectorStore } from "../store.js";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function riskClass(level: RiskLevel): string {
  return `ai-risk ai-risk--${level}`;
}

function markerClass(event: AgentEvent): string {
  const base = `ai-step-marker ai-step-marker--${event.type}`;
  if (event.type === "tool_call") {
    return `${base} ai-step-marker--risk-${event.data.riskLevel}`;
  }
  if (event.type === "approval_request") {
    return `${base} ai-step-marker--risk-${event.data.riskLevel}`;
  }
  return base;
}

function StepBody({ event }: { event: AgentEvent }) {
  const expanded = useInspectorStore((s) => s.expandedIds.has(event.id));
  const toggle = useInspectorStore((s) => s.toggleExpanded);

  switch (event.type) {
    case "run_start":
      return (
        <p className="ai-reasoning">
          Run started
          {event.data.agentName ? ` · ${event.data.agentName}` : ""}
          {event.data.threadId ? ` · thread ${event.data.threadId}` : ""}
        </p>
      );
    case "run_end":
      return (
        <p className="ai-reasoning">
          Run {event.data.status}
          {event.data.summary ? ` - ${event.data.summary}` : ""}
        </p>
      );
    case "reasoning": {
      const long = event.data.content.length > 160;
      return (
        <div className="ai-reasoning">
          <div className={expanded || !long ? undefined : "ai-reasoning-preview"}>
            {event.data.content}
          </div>
          {long && (
            <button type="button" className="ai-toggle" onClick={() => toggle(event.id)}>
              {expanded ? "Collapse" : "Expand reasoning"}
            </button>
          )}
        </div>
      );
    }
    case "tool_call":
      return (
        <div>
          <div className="ai-step-head" style={{ marginBottom: 0 }}>
            <span className="ai-step-label">
              {event.data.toolName}
              <span className={riskClass(event.data.riskLevel)}>{event.data.riskLevel}</span>
              {event.data.requiresApproval && (
                <span className="ai-risk ai-risk--high" style={{ marginLeft: 6 }}>
                  gated
                </span>
              )}
            </span>
          </div>
          <pre className="ai-code">{pretty(event.data.input)}</pre>
        </div>
      );
    case "tool_result":
      return (
        <div>
          <span className="ai-step-label ai-step-label--muted">
            {"<-"} {event.data.toolName}
            {event.data.durationMs != null ? ` · ${event.data.durationMs}ms` : ""}
          </span>
          <pre
            className={`ai-code ai-code--output${event.data.isError ? " ai-code--error" : ""}`}
          >
            {pretty(event.data.output)}
          </pre>
        </div>
      );
    case "approval_request":
      return (
        <p className="ai-reasoning">
          Approval requested: <strong>{event.data.actionSummary}</strong>
        </p>
      );
    case "approval_response":
      return (
        <p className="ai-reasoning">
          Decision: <strong>{event.data.decision}</strong>
          {event.data.decidedBy ? ` by ${event.data.decidedBy}` : ""}
        </p>
      );
    case "state_update":
      return (
        <div>
          <span className="ai-step-label ai-step-label--muted">
            State{event.data.path ? ` · ${event.data.path}` : ""}
          </span>
          {event.data.summary && <p className="ai-reasoning">{event.data.summary}</p>}
          {(event.data.before !== undefined || event.data.after !== undefined) && (
            <pre className="ai-code">
              {pretty({ before: event.data.before, after: event.data.after })}
            </pre>
          )}
        </div>
      );
    case "error":
      return (
        <pre className="ai-code ai-code--error">
          {event.data.message}
          {event.data.stack ? `\n\n${event.data.stack}` : ""}
        </pre>
      );
    default:
      return null;
  }
}

function stepTitle(event: AgentEvent): string {
  switch (event.type) {
    case "run_start":
      return "Run start";
    case "run_end":
      return "Run end";
    case "reasoning":
      return "Reasoning";
    case "tool_call":
      return "Tool call";
    case "tool_result":
      return "Tool result";
    case "approval_request":
      return "Approval request";
    case "approval_response":
      return "Approval response";
    case "state_update":
      return "State update";
    case "error":
      return "Error";
    default:
      return "Event";
  }
}

export function TimelineStep({ event }: { event: AgentEvent }) {
  const isReasoning = event.type === "reasoning";
  return (
    <li className="ai-step">
      <span className={markerClass(event)} aria-hidden />
      <div className="ai-step-head">
        <span className={`ai-step-label${isReasoning ? " ai-step-label--muted" : ""}`}>
          {stepTitle(event)}
        </span>
        <time className="ai-step-time" dateTime={event.timestamp}>
          {formatTime(event.timestamp)}
        </time>
      </div>
      <StepBody event={event} />
    </li>
  );
}

export function Timeline({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="ai-empty">
        <h2>No events yet</h2>
        <p>Load a run log or connect a live SSE stream to see the trajectory.</p>
      </div>
    );
  }

  return (
    <ol className="ai-timeline">
      {events.map((event) => (
        <TimelineStep key={event.id} event={event} />
      ))}
    </ol>
  );
}

