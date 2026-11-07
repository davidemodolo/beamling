"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { useAccount, useConversations } from "@/lib/store";
import { UserAvatar } from "@/components/user-avatar";
import { plural, shortDate } from "@/lib/utils";

export function AccountPanel() {
  const router = useRouter();
  const { user, credentials, deleteAccount, settings, signOut, updateSettings } = useAccount();
  const { conversationCount } = useConversations();
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

  const toggleAnalytics = async (optOut: boolean) => {
    try {
      await updateSettings({ analyticsOptOut: optOut });
      showToast(optOut ? "Excluded from analytics. Past events are being deleted." : "Analytics enabled again.");
    } catch (cause) {
      showToast(errorMessage(cause, "Could not update the analytics preference"));
    }
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-body" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <UserAvatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} size={46} />
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
                {plural(conversationCount, "conversation")} · {plural(credentials.length, "encrypted key")}
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
              <div className="row-title">Sign out everywhere</div>
              <div className="row-hint">Revoke every session of this account, on all browsers and devices.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void signOut(true)}>
              Sign out everywhere
            </button>
          </div>
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Cookie</div>
              <div className="row-hint">
                HttpOnly, SameSite=Lax. Expires after 30 days without use and 90 days after sign-in. Signing out
                revokes it immediately.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>Your data</h2>
            <p>Your rights under the GDPR, without having to write to us.</p>
          </div>
        </div>
        <div className="settings-card-body tight">
          <div className="setting-row">
            <div className="grow">
              <div className="row-title">Download my data</div>
              <div className="row-hint">
                A JSON file with your account, settings, conversations, sources and key metadata. Keys themselves are
                never included.
              </div>
            </div>
            <a className="btn btn-secondary btn-sm" href="/api/account/export" download>
              Download
            </a>
          </div>
          <div className="setting-row">
            <label className="grow check-row" htmlFor="analytics-opt-out" style={{ alignItems: "flex-start" }}>
              <input
                id="analytics-opt-out"
                type="checkbox"
                checked={settings.analyticsOptOut}
                onChange={(event) => void toggleAnalytics(event.target.checked)}
              />
              <span>
                <span className="row-title">Exclude me from product analytics</span>
                <span className="row-hint" style={{ display: "block", fontWeight: 400 }}>
                  Stops usage metadata being sent and deletes what was already collected. Questions, answers and keys
                  are never part of analytics.
                </span>
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className="settings-card" style={{ borderColor: "color-mix(in oklab, var(--error) 30%, var(--line))" }}>
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2 style={{ color: "var(--error)" }}>Delete account</h2>
            <p>
              Permanently delete your account, sessions, settings, conversations, sources, keys, usage records and
              analytics. To also remove Beamling&apos;s access to your Google account, visit your Google account&apos;s
              third-party connections page.
            </p>
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
        Read the <a href="/terms" style={{ color: "var(--accent)", textDecoration: "underline" }}>terms</a> and{" "}
        <a href="/privacy" style={{ color: "var(--accent)", textDecoration: "underline" }}>privacy notice</a> you
        accepted.
      </p>

      {toast}
    </div>
  );
}
