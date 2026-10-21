"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";

export function TermsAcceptance({ version, next, minimumAge }: { version: string; next: string; minimumAge: number }) {
  const [accepted, setAccepted] = useState(false);
  const [adult, setAdult] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accepted || !adult || pending) return;
    setPending(true);
    setError("");
    try {
      await api("/api/account/terms", { method: "POST", body: JSON.stringify({ version, confirmAge: true }) });
      window.location.replace(next);
    } catch (cause) {
      setError(errorMessage(cause, "Could not record your acceptance. Try again."));
      setPending(false);
    }
  };

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.replace("/");
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <label className="check-row">
        <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
        <span>I am at least {minimumAge} years old.</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>
          I accept the <Link href="/terms" target="_blank">Terms</Link> and have read the{" "}
          <Link href="/privacy" target="_blank">Privacy notice</Link>.
        </span>
      </label>
      {error ? (
        <p className="validation-err" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={!accepted || !adult || pending}>
          {pending ? "Saving…" : "Accept and continue"}
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </form>
  );
}
