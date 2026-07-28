import type {
  AgentEvent,
  AgentRunLog,
  ApprovalDecision,
  PendingApproval,
} from "@agent-inspector/core";
import { getPendingApproval, MOCK_RUN } from "@agent-inspector/core";
import { EventEmitter } from "node:events";

/**
 * In-memory session bus shared by Next.js API routes and the CLI process.
 * Module singleton is fine for localhost single-process Next.
 */

export type InspectorSessionMode = "file" | "live";

export interface InspectorSession {
  mode: InspectorSessionMode;
  runId: string;
  agentName?: string;
  events: AgentEvent[];
  logPath?: string;
  /** Resolvers waiting on human approval keyed by toolCallId */
  approvalWaiters: Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      reject: (err: Error) => void;
    }
  >;
  stepIndex: number;
}

class SessionBus extends EventEmitter {
  session: InspectorSession;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.session = {
      mode: "file",
      runId: MOCK_RUN.runId,
      agentName: MOCK_RUN.agentName,
      events: [...MOCK_RUN.events],
      approvalWaiters: new Map(),
      stepIndex: MOCK_RUN.events.length,
    };
  }

  loadRun(log: AgentRunLog, logPath?: string): void {
    this.session = {
      mode: "file",
      runId: log.runId,
      agentName: log.agentName,
      events: [...log.events],
      logPath,
      approvalWaiters: new Map(),
      stepIndex: log.events.length,
    };
    this.emit("reset", this.snapshot());
  }

  startLive(runId: string, agentName?: string): void {
    this.session = {
      mode: "live",
      runId,
      agentName,
      events: [],
      approvalWaiters: new Map(),
      stepIndex: 0,
    };
    this.emit("reset", this.snapshot());
  }

  append(events: AgentEvent[]): void {
    if (events.length === 0) return;
    this.session.events.push(...events);
    const last = events[events.length - 1];
    if (last) {
      this.session.stepIndex = Math.max(this.session.stepIndex, last.stepIndex + 1);
    }
    this.emit("events", events);
  }

  snapshot(): {
    mode: InspectorSessionMode;
    runId: string;
    agentName?: string;
    events: AgentEvent[];
    pending: PendingApproval | null;
    logPath?: string;
  } {
    return {
      mode: this.session.mode,
      runId: this.session.runId,
      agentName: this.session.agentName,
      events: this.session.events,
      pending: getPendingApproval(this.session.events),
      logPath: this.session.logPath,
    };
  }

  /**
   * Register that execution is blocked on this toolCallId.
   * Returns a promise that resolves when the UI posts approve/deny.
   */
  waitForApproval(toolCallId: string): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      this.session.approvalWaiters.set(toolCallId, { resolve, reject });
    });
  }

  decide(toolCallId: string, decision: ApprovalDecision): boolean {
    const waiter = this.session.approvalWaiters.get(toolCallId);
    const responseEvent: AgentEvent = {
      id: `evt_approval_${toolCallId}_${Date.now()}`,
      type: "approval_response",
      timestamp: new Date().toISOString(),
      runId: this.session.runId,
      stepIndex: this.session.stepIndex++,
      data: {
        toolCallId,
        decision,
        decidedAt: new Date().toISOString(),
        decidedBy: "operator",
      },
    };
    this.append([responseEvent]);

    if (waiter) {
      waiter.resolve(decision);
      this.session.approvalWaiters.delete(toolCallId);
      return true;
    }
    return false;
  }
}

const globalKey = "__agent_inspector_bus__";

export function getBus(): SessionBus {
  const g = globalThis as typeof globalThis & { [globalKey]?: SessionBus };
  if (!g[globalKey]) {
    g[globalKey] = new SessionBus();
  }
  return g[globalKey];
}
