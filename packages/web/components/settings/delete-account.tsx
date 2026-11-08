"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useAccount } from "@/lib/store";

/** Permanent account deletion, confirmed by typing DELETE. Used in Settings and during setup. */
export function DeleteAccount({ onError }: { onError: (message: string) => void }) {
  const { deleteAccount } = useAccount();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  const remove = async () => {
    if (confirm !== "DELETE" || pending) return;
    setPending(true);
    try {
      await deleteAccount();
      // A full load: `/` now renders the landing page, not the cached app.
      window.location.replace("/");
    } catch (cause) {
      onError(errorMessage(cause, "Could not delete the account"));
      setPending(false);
    }
  };

  return (
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
  );
}
