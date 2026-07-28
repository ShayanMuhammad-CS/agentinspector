"use client";

import type { AgentEvent, ApprovalDecision, PendingApproval } from "@kashifmuhammad/agent-inspector-core";
import { getPendingApproval } from "@kashifmuhammad/agent-inspector-core";
import { create } from "zustand";

export type InspectorMode = "replay" | "live";

export interface InspectorState {
  events: AgentEvent[];
  mode: InspectorMode;
  runId: string | null;
  agentName: string | null;
  expandedIds: Set<string>;
  deciding: boolean;
  setLog: (events: AgentEvent[], meta?: { runId?: string; agentName?: string; mode?: InspectorMode }) => void;
  appendEvents: (events: AgentEvent[]) => void;
  toggleExpanded: (id: string) => void;
  setDeciding: (v: boolean) => void;
  getPending: () => PendingApproval | null;
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
  events: [],
  mode: "replay",
  runId: null,
  agentName: null,
  expandedIds: new Set(),
  deciding: false,
  setLog: (events, meta) =>
    set({
      events,
      runId: meta?.runId ?? events[0]?.runId ?? null,
      agentName: meta?.agentName ?? null,
      mode: meta?.mode ?? "replay",
      expandedIds: new Set(),
    }),
  appendEvents: (incoming) =>
    set((s) => ({
      events: [...s.events, ...incoming],
      runId: s.runId ?? incoming[0]?.runId ?? null,
    })),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expandedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedIds: next };
    }),
  setDeciding: (deciding) => set({ deciding }),
  getPending: () => getPendingApproval(get().events),
}));

export type OnApprovalHandler = (
  toolCallId: string,
  decision: ApprovalDecision
) => void | Promise<void>;

