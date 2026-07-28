"use client";

import type { PendingApproval } from "@agent-inspector/core";
import type { OnApprovalHandler } from "../store.js";

interface ApprovalCardProps {
  pending: PendingApproval;
  deciding?: boolean;
  readOnly?: boolean;
  onDecision?: OnApprovalHandler;
}

export function ApprovalCard({
  pending,
  deciding,
  readOnly,
  onDecision,
}: ApprovalCardProps) {
  return (
    <div className="ai-approval-card" role="alertdialog" aria-labelledby="ai-approval-title">
      <div className="ai-approval-eyebrow">Action requires approval</div>
      <h2 id="ai-approval-title" className="ai-approval-title">
        Agent wants to: {pending.actionSummary}
      </h2>
      {pending.resource && (
        <div className="ai-approval-resource">resource · {pending.resource}</div>
      )}
      <div className="ai-risk-row" style={{ marginBottom: 8 }}>
        <span className={`ai-risk ai-risk--${pending.riskLevel}`}>{pending.riskLevel}</span>
        <span style={{ marginLeft: 8, fontFamily: "var(--ai-mono)", fontSize: 12, color: "var(--ai-text-muted)" }}>
          {pending.toolName}
        </span>
      </div>
      <pre className="ai-code">{JSON.stringify(pending.input, null, 2)}</pre>
      {!readOnly && onDecision ? (
        <div className="ai-approval-actions">
          <button
            type="button"
            className="ai-btn ai-btn--approve"
            disabled={deciding}
            onClick={() => void onDecision(pending.toolCallId, "approve")}
          >
            Approve
          </button>
          <button
            type="button"
            className="ai-btn ai-btn--deny"
            disabled={deciding}
            onClick={() => void onDecision(pending.toolCallId, "deny")}
          >
            Deny
          </button>
        </div>
      ) : (
        <p className="ai-idle-note">
          {readOnly
            ? "Replay mode — decisions were recorded with this run."
            : "Waiting for an approval handler…"}
        </p>
      )}
    </div>
  );
}
