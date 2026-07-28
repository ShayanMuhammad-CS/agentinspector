"use client";

import { AgentInspector, useInspectorStore } from "@kashifmuhammad/agent-inspector-react";
import { createElement, useCallback, useEffect, useState } from "react";

export default function HomePage() {
  const setLog = useInspectorStore((s) => s.setLog);
  const appendEvents = useInspectorStore((s) => s.appendEvents);
  const [mode, setMode] = useState("replay");
  const [agentName, setAgentName] = useState(undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let es = null;
    let cancelled = false;

    async function boot() {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
        const data = await res.json();
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
              const batch = JSON.parse(msg.data);
              appendEvents(batch);
            } catch {
              // ignore malformed
            }
          });
          es.addEventListener("reset", (msg) => {
            try {
              const snap = JSON.parse(msg.data);
              setLog(snap.events, {
                mode: "live",
                agentName: snap.agentName,
                runId: snap.runId,
              });
            } catch {
              // ignore malformed
            }
          });
          es.onerror = () => {
            // browser retries automatically
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
      if (es) es.close();
    };
  }, [setLog, appendEvents]);

  const onApproval = useCallback(async (toolCallId, decision) => {
    const res = await fetch("/api/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolCallId, decision }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Approval failed (${res.status})`);
    }
  }, []);

  if (error) {
    return createElement(
      "div",
      { className: "ai-root", style: { padding: 40 } },
      createElement("h1", { style: { color: "var(--ai-danger)" } }, "Failed to start"),
      createElement("p", { style: { color: "var(--ai-text-muted)" } }, error)
    );
  }

  if (!ready) {
    return createElement(
      "div",
      { className: "ai-root", style: { padding: 40, color: "var(--ai-text-muted)" } },
      "Loading trajectory..."
    );
  }

  return createElement(AgentInspector, {
    mode,
    agentName,
    onApproval: mode === "live" ? onApproval : undefined,
  });
}
