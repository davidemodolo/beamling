"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { Credential, CredentialStatus } from "@/lib/types";
import { shortDate } from "@/lib/utils";

const STATUS_LABEL: Record<CredentialStatus, string> = {
  active: "Active",
  invalid: "Rejected",
  rate_limited: "Rate limited",
  unverified: "Unverified",
};

export function CredentialRow({
  credential,
  label,
  busy,
  deleting,
  onValidate,
  onDelete,
}: {
  credential: Credential;
  label: string;
  busy: boolean;
  deleting: boolean;
  onValidate: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="key-card">
      <div className="key-icon">
        <Icon name={credential.kind === "llm" ? "sparkles" : "globe"} size={16} />
        <span className={`dot status-dot ${credential.status}`} />
      </div>
      <div className="key-main">
        <strong>{label}</strong>
        <span>•••• {credential.last4}</span>
        <span style={{ color: credential.status === "invalid" ? "var(--error)" : "var(--muted)" }}>
          {STATUS_LABEL[credential.status]} · checked {shortDate(credential.lastValidatedAt)}
        </span>
      </div>
      <div className="key-actions">
        {confirming ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" onClick={onDelete} disabled={deleting}>
              {deleting ? <Icon name="loader" size={13} className="spin" /> : null}
              Delete
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={deleting}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={onValidate}
              disabled={busy}
              aria-label={`Validate ${label}`}
              title="Validate again"
            >
              <Icon name={busy ? "loader" : "refresh"} size={14} className={busy ? "spin" : undefined} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${label}`}
              title="Delete"
            >
              <Icon name="trash" size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
