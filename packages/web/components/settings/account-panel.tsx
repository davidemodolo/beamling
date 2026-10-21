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
  const { user, conversationCount, credentials, deleteAccount, signOut } = useStore();
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
      showToast(errorMessage(cause, "Could not delete the account"));
      setPending(false);
    }
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-body" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div className="avatar" style={{ width: 46, height: 46, fontSize: 15 }}>
            {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{user?.name ?? "Google account"}</div>
            <div className="hint">
              {user ? `${user.email} · joined ${shortDate(user.createdAt)}` : "Loading…"}
            </div>
          </div>
          <span className="badge badge-success">Google</span>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>Session</h2>
            <p>Signed in with Google.</p>
          </div>
        </div>
        <div className="settings-card-body tight">
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Storage</div>
              <div className="row-hint">
                {conversationCount} {conversationCount === 1 ? "conversation" : "conversations"} · {credentials.length} encrypted keys
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Sign out</div>
              <div className="row-hint">Revoke this session on this browser.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void signOut()}>Sign out</button>
          </div>
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Cookie</div>
              <div className="row-hint">
                HttpOnly, SameSite=Lax. Expires after 30 days without use. Signing out revokes it immediately.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card" style={{ borderColor: "color-mix(in oklab, var(--error) 30%, var(--line))" }}>
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2 style={{ color: "var(--error)" }}>Delete account</h2>
            <p>Remove every conversation, source, key and workspace data key.</p>
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
            <Icon name="trash" size={14} /> Delete my account
          </button>
        </form>
      </section>

      <p className="hint">
        By using Beamling you agree to the <a href="/terms" style={{ color: "var(--accent)", textDecoration: "underline" }}>terms</a> and{" "}
        <a href="/privacy" style={{ color: "var(--accent)", textDecoration: "underline" }}>privacy policy</a>.
      </p>

      {toast}
    </div>
  );
}
