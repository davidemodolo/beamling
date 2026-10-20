"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { useStore } from "@/lib/store";
import { shortDate } from "@/lib/utils";

export function AccountPanel() {
  const router = useRouter();
  const { user, conversations, credentials, deleteAccount } = useStore();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, showToast] = useToast();

  const remove = async () => {
    if (confirm !== "DELETE" || pending) return;
    setPending(true);
    try {
      await deleteAccount();
      router.push("/");
    } catch (cause) {
      showToast(errorMessage(cause, "Could not delete the workspace"));
      setPending(false);
    }
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-body" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div className="avatar" style={{ width: 46, height: 46, fontSize: 15 }}>G</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Guest workspace</div>
            <div className="hint">
              {user ? `Workspace ${user.id.slice(0, 8)} · started ${shortDate(user.createdAt)}` : "Loading…"}
            </div>
          </div>
          <span className="badge badge-success">No billing</span>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>Session</h2>
            <p>This browser is the account.</p>
          </div>
        </div>
        <div className="settings-card-body tight">
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Storage</div>
              <div className="row-hint">
                {conversations.length} conversations · {credentials.length} encrypted keys
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Cookie</div>
              <div className="row-hint">HttpOnly, SameSite=Lax, 30-day expiry.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card" style={{ borderColor: "color-mix(in oklab, var(--error) 30%, var(--line))" }}>
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2 style={{ color: "var(--error)" }}>Delete workspace</h2>
            <p>Remove every conversation, source, and key.</p>
          </div>
        </div>
        <form
          className="settings-card-body"
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <div className="field">
            <label className="label" htmlFor="confirm-delete">Type DELETE to confirm</label>
            <input
              id="confirm-delete"
              className="input"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn btn-danger" disabled={confirm !== "DELETE" || pending}>
            <Icon name="trash" size={14} /> Delete this workspace
          </button>
        </form>
      </section>

      <p className="hint">
        By using Beamling you agree to the <a href="/terms" style={{ color: "var(--accent)" }}>terms</a> and{" "}
        <a href="/privacy" style={{ color: "var(--accent)" }}>privacy policy</a>.
      </p>

      {toast}
    </div>
  );
}
