import { adaptLangGraphStreamEvent } from "@kashifmuhammad/agent-inspector-core";
import { getBus } from "../../../dist/bus.js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  const bus = getBus();
  if (bus.session.mode !== "live") {
    return NextResponse.json(
      {
        error: "Server is in file/replay mode. Restart with: agent-inspector --live",
      },
      { status: 400 }
    );
  }

  const body = await req.json();
  const approvalConfig = extractApprovalConfig(body);
  const rawEvents = extractRawEvents(body);

  const adapted = [];
  let step = bus.session.stepIndex;

  for (const raw of rawEvents) {
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

function extractApprovalConfig(body) {
  if (!body || typeof body !== "object") return undefined;
  return body.approvalConfig;
}

function extractRawEvents(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (typeof body === "object") {
    if (Array.isArray(body.events)) return body.events;
    return [body];
  }
  return [];
}

function isAgentEvent(raw) {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof raw.type === "string" &&
    typeof raw.id === "string" &&
    typeof raw.runId === "string"
  );
}
