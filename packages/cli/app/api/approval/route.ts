import type { ApprovalDecision } from "@agent-inspector/core";
import { getBus } from "../../../src/bus";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    toolCallId?: string;
    decision?: ApprovalDecision;
  };

  if (!body.toolCallId || (body.decision !== "approve" && body.decision !== "deny")) {
    return NextResponse.json(
      { error: "Expected { toolCallId: string, decision: 'approve' | 'deny' }" },
      { status: 400 }
    );
  }

  const bus = getBus();
  bus.decide(body.toolCallId, body.decision);
  return NextResponse.json({ ok: true, toolCallId: body.toolCallId, decision: body.decision });
}
