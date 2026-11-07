"use client";

import { useState } from "react";
import { useAccount } from "@/lib/store";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";

/** Shown when the account state could not be loaded; Retry re-fetches it. */
export function WorkspaceError({ message }: { message: string }) {
  const { refresh } = useAccount();
  const [pending, setPending] = useState(false);

  const retry = async () => {
    setPending(true);
    await refresh();
    setPending(false);
  };

  return (
    <div role="alert" style={{ padding: "60px 16px", textAlign: "center", margin: "0 auto" }}>
      <div className="sources-empty" style={{ padding: 0 }}>
        <div className="mark" style={{ width: 90 }}>
          <Mascot state="error" beams={false} label="" style={{ width: 90 }} />
        </div>
        <h1 style={{ color: "var(--text)", fontSize: 22, marginBottom: 6 }}>Could not load your workspace</h1>
        <p style={{ marginBottom: 18 }}>{message}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void retry()} disabled={pending}>
          <Icon name={pending ? "loader" : "refresh"} size={14} className={pending ? "spin" : undefined} /> Retry
        </button>
      </div>
    </div>
  );
}
