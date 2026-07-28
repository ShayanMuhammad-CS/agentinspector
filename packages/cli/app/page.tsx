"use client";

import {
  AgentInspector,
  useInspectorStore,
} from "@kashifmuhammad/agent-inspector-react";
import type { AgentEvent, ApprovalDecision } from "@kashifmuhammad/agent-inspector-core";
import { useCallback, useEffect, useState } from "react";

interface Snapshot {
  mode: "file" | "live";
  runId: string;
  agentName?: string;
  events: AgentEvent[];
  pending: unknown;
  logPath?: string;
}

export default function HomePage() {
  const setLog = useInspectorStore((s) => s.setLog);
  const appendEvents = useInspectorStore((s) => s.appendEvents);
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [agentName, setAgentName] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    async function boot() {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
        const data = (await res.json()) as Snapshot;
        if (cancelled) return;
        setMode(data.mode === "live" ? "live" : "replay");
        setAgentName(data.agentName);
        setLog(data.events, {
          mode: data.mode === "live" ? "live" : "replay",
          agentName: data.agentName,
          runId: data.runId,
        });
        setReady(true);

        if (data.mode === "live") {
          es = new EventSource("/api/stream");
          es.addEventListener("events", (msg) => {
            try {
              const batch = JSON.parse((msg as MessageEvent).data) as AgentEvent[];
              appendEvents(batch);
            } catch {
              /* ignore malformed */
            }
          });
          es.addEventListener("reset", (msg) => {
            try {
              const snap = JSON.parse((msg as MessageEvent).data) as Snapshot;
              setLog(snap.events, {
                mode: "live",
                agentName: snap.agentName,
                runId: snap.runId,
              });
            } catch {
              /* ignore */
            }
          });
          es.onerror = () => {
            /* browser will retry */
          };
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [setLog, appendEvents]);

  const onApproval = useCallback(
    async (toolCallId: string, decision: ApprovalDecision) => {
      const res = await fetch("/api/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Approval failed (${res.status})`);
      }
    },
    []
  );

  if (error) {
    return (
      <div className="ai-root" style={{ padding: 40 }}>
        <h1 style={{ color: "var(--ai-danger)" }}>Failed to start</h1>
        <p style={{ color: "var(--ai-text-muted)" }}>{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="ai-root" style={{ padding: 40, color: "var(--ai-text-muted)" }}>
        Loading trajectory...
      </div>
    );
  }

  return (
    <AgentInspector
      mode={mode}
      agentName={agentName}
      onApproval={mode === "live" ? onApproval : undefined}
    />
  );
}

