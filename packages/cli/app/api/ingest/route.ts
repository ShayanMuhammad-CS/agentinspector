import {
  adaptLangGraphStreamEvent,
  type ApprovalConfig,
} from "@agent-inspector/core";
import { getBus } from "../../../src/bus";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ingest a LangGraph stream event (or batch) from your agent bridge.
 *
 * Body shapes accepted:
 * - single stream event object
 * - { events: [...] }
 * - { type: "run_start" | "run_end", ... } already-normalized AgentEvent(s)
 *
 * When a gated tool call is detected, response includes:
 *   { paused: true, toolCallId, waitUrl: "/api/approval" }
 * and the HTTP handler awaits the operator decision before returning
 * { decision: "approve" | "deny" } — so your bridge can block the agent.
 */
export async function POST(req: Request) {
  const bus = getBus();
  if (bus.session.mode !== "live") {
    return NextResponse.json(
      {
        error:
          "Server is in file/replay mode. Restart with: agent-inspector --live",
      },
      { status: 400 }
    );
  }

  const body = (await req.json()) as unknown;
  const approvalConfig = extractApprovalConfig(body);
  const rawEvents = extractRawEvents(body);

  const adapted = [];
  let step = bus.session.stepIndex;

  for (const raw of rawEvents) {
    // Pass-through if already our schema
    if (isAgentEvent(raw)) {
      adapted.push(raw);
      step = Math.max(step, raw.stepIndex + 1);
      continue;
    }

    const result = adaptLangGraphStreamEvent(raw, {
      runId: bus.session.runId,
      stepIndex: step,
      approvalConfig,
      emitApprovalRequests: true,
    });
    adapted.push(...result.events);
    step = result.nextStepIndex;
  }

  bus.session.stepIndex = step;
  bus.append(adapted);

  const approvalReq = adapted.find((e) => e.type === "approval_request");
  if (approvalReq && approvalReq.type === "approval_request") {
    const toolCallId = approvalReq.data.toolCallId;
    // Block this HTTP request until the human decides — pause/resume mechanic
    const decision = await bus.waitForApproval(toolCallId);
    return NextResponse.json({
      ok: true,
      paused: true,
      toolCallId,
      decision,
      ingested: adapted.length,
    });
  }

  return NextResponse.json({ ok: true, ingested: adapted.length, paused: false });
}

function extractApprovalConfig(body: unknown): ApprovalConfig | undefined {
  if (!body || typeof body !== "object") return undefined;
  const cfg = (body as { approvalConfig?: ApprovalConfig }).approvalConfig;
  return cfg;
}

function extractRawEvents(body: unknown): unknown[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.events)) return obj.events;
    return [body];
  }
  return [];
}

function isAgentEvent(raw: unknown): raw is import("@agent-inspector/core").AgentEvent {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as { type?: unknown }).type === "string" &&
    typeof (raw as { id?: unknown }).id === "string" &&
    typeof (raw as { runId?: unknown }).runId === "string"
  );
}
