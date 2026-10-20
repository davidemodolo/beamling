"use client";

import { useState, type FormEvent } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { useStore } from "@/lib/store";
import type { Credential, CredentialKind } from "@/lib/types";
import { CredentialRow } from "./credential-row";

const PROVIDERS: {
  kind: CredentialKind;
  provider: string;
  name: string;
  description: string;
  inputId: string;
  placeholder: string;
}[] = [
  {
    kind: "llm",
    provider: "openrouter",
    name: "OpenRouter",
    description: "Used for every answer.",
    inputId: "openrouter-key",
    placeholder: "sk-or-v1-...",
  },
  {
    kind: "search",
    provider: "brave",
    name: "Brave Search",
    description: "Used for every web search.",
    inputId: "brave-key",
    placeholder: "BSA...",
  },
];

export function KeysPanel() {
  const { credentials, addCredential, removeCredential, validateCredential } = useStore();
  const [editing, setEditing] = useState<CredentialKind | null>(null);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const start = (kind: CredentialKind) => {
    setEditing(kind);
    setKey("");
    setError("");
  };

  const cancel = () => {
    setEditing(null);
    setKey("");
    setError("");
  };

  const save = async (provider: (typeof PROVIDERS)[number]) => {
    if (pending) return;
    const value = key.trim();
    if (value.length < 8) {
      setError("Paste the full key and try again.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await addCredential({ kind: provider.kind, provider: provider.provider, key: value });
      showToast(`${provider.name} key saved`);
      cancel();
    } catch (cause) {
      setError(errorMessage(cause, "The provider rejected this key."));
    } finally {
      setPending(false);
    }
  };

  const revalidate = async (credential: Credential) => {
    setValidating(credential.id);
    try {
      await validateCredential(credential.id);
      showToast("Key validated");
    } catch (cause) {
      showToast(errorMessage(cause, "Validation failed"));
    } finally {
      setValidating(null);
    }
  };

  const remove = async (credential: Credential) => {
    setDeleting(credential.id);
    try {
      await removeCredential(credential.id);
      showToast("Key deleted");
    } catch (cause) {
      showToast(errorMessage(cause, "Could not delete the key"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="settings-stack">
      {PROVIDERS.map((provider) => {
        const credential = credentials.find((item) => item.kind === provider.kind);
        return (
          <section className="settings-card" key={provider.kind}>
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2>{provider.name}</h2>
                <p>{provider.description}</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => start(provider.kind)}>
                <Icon name={credential ? "refresh" : "plus"} size={13} /> {credential ? "Replace" : "Add key"}
              </button>
            </div>
            <div className="settings-card-body tight">
              {credential ? (
                <CredentialRow
                  credential={credential}
                  label={provider.name}
                  busy={validating === credential.id}
                  deleting={deleting === credential.id}
                  onValidate={() => void revalidate(credential)}
                  onDelete={() => void remove(credential)}
                />
              ) : (
                <p className="hint" style={{ padding: 18 }}>No {provider.name} key connected.</p>
              )}
              {editing === provider.kind ? (
                <KeyForm
                  id={provider.inputId}
                  label={`${provider.name} API key`}
                  placeholder={provider.placeholder}
                  value={key}
                  pending={pending}
                  error={error}
                  onChange={setKey}
                  onCancel={cancel}
                  onSave={() => void save(provider)}
                />
              ) : null}
            </div>
          </section>
        );
      })}

      <div className="notice">
        <Icon name="shield" size={16} />
        <div>Keys are validated with the provider, encrypted at rest, and never returned to the browser.</div>
      </div>

      {toast}
    </div>
  );
}

function KeyForm({
  id,
  label,
  placeholder,
  value,
  pending,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  pending: boolean;
  error: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending && value.trim()) onSave();
  };

  return (
    <form onSubmit={submit} style={{ padding: "16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <SecretKeyInput id={id} value={value} onChange={onChange} placeholder={placeholder} invalid={!!error} />
      {error ? (
        <p className="validation-err" role="alert">
          <Icon name="alert" size={12} /> {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !value.trim()}>
          {pending ? <Icon name="loader" size={13} className="spin" /> : <Icon name="check" size={13} />}
          {pending ? "Validating…" : "Save key"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
