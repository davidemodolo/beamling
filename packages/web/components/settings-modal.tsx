"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { OPENROUTER_MODELS } from "@/lib/providers";
import { useStore } from "@/lib/store";
import type { Credential, CredentialKind, Mode } from "@/lib/types";
import { shortDate } from "@/lib/utils";

type Tab = "keys" | "defaults" | "account";

const TABS: { id: Tab; label: string; icon: "key" | "settings" | "user" }[] = [
  { id: "keys", label: "Keys", icon: "key" },
  { id: "defaults", label: "Defaults", icon: "settings" },
  { id: "account", label: "Account", icon: "user" },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("keys");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      width={680}
      footer={
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="segmented" role="tablist" aria-label="Settings sections" style={{ width: "fit-content", marginBottom: 20 }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={12} /> {item.label}
          </button>
        ))}
      </div>
      {tab === "keys" ? <KeysPanel /> : null}
      {tab === "defaults" ? <DefaultsPanel /> : null}
      {tab === "account" ? <AccountPanel /> : null}
    </Modal>
  );
}

function KeysPanel() {
  const { credentials, addCredential, removeCredential, validateCredential } = useStore();
  const [editing, setEditing] = useState<CredentialKind | null>(null);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const llm = credentials.find((credential) => credential.kind === "llm");
  const search = credentials.find((credential) => credential.kind === "search");

  const start = (kind: CredentialKind) => {
    setEditing(kind);
    setKey("");
    setError("");
    setShowKey(false);
  };

  const save = async () => {
    if (!editing || pending) return;
    const value = key.trim();
    if (value.length < 8) {
      setError("Paste the full key and try again.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await addCredential({
        kind: editing,
        provider: editing === "llm" ? "openrouter" : "brave",
        key: value,
      });
      setToast(editing === "llm" ? "OpenRouter key saved" : "Brave key saved");
      setEditing(null);
      setKey("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The provider rejected this key.");
    } finally {
      setPending(false);
    }
  };

  const revalidate = async (credential: Credential) => {
    setValidating(credential.id);
    try {
      await validateCredential(credential.id);
      setToast("Key validated");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Validation failed");
    } finally {
      setValidating(null);
    }
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>OpenRouter</h2>
            <p>Used for every answer.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => start("llm")}>
            <Icon name={llm ? "refresh" : "plus"} size={13} /> {llm ? "Replace" : "Add key"}
          </button>
        </div>
        <div className="settings-card-body tight">
          {llm ? (
            <CredentialRow
              credential={llm}
              label="OpenRouter"
              busy={validating === llm.id}
              onValidate={() => void revalidate(llm)}
              onDelete={() => {
                void removeCredential(llm.id);
                setToast("Key deleted");
              }}
            />
          ) : (
            <p className="hint" style={{ padding: 18 }}>No OpenRouter key connected.</p>
          )}
          {editing === "llm" ? (
            <KeyForm
              id="openrouter-key"
              label="OpenRouter API key"
              placeholder="sk-or-v1-..."
              value={key}
              show={showKey}
              pending={pending}
              error={error}
              onChange={setKey}
              onToggle={() => setShowKey((shown) => !shown)}
              onCancel={() => setEditing(null)}
              onSave={() => void save()}
            />
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>Brave Search</h2>
            <p>Used for every web search.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => start("search")}>
            <Icon name={search ? "refresh" : "plus"} size={13} /> {search ? "Replace" : "Add key"}
          </button>
        </div>
        <div className="settings-card-body tight">
          {search ? (
            <CredentialRow
              credential={search}
              label="Brave Search"
              busy={validating === search.id}
              onValidate={() => void revalidate(search)}
              onDelete={() => {
                void removeCredential(search.id);
                setToast("Key deleted");
              }}
            />
          ) : (
            <p className="hint" style={{ padding: 18 }}>No Brave Search key connected.</p>
          )}
          {editing === "search" ? (
            <KeyForm
              id="brave-key"
              label="Brave Search API key"
              placeholder="BSA..."
              value={key}
              show={showKey}
              pending={pending}
              error={error}
              onChange={setKey}
              onToggle={() => setShowKey((shown) => !shown)}
              onCancel={() => setEditing(null)}
              onSave={() => void save()}
            />
          ) : null}
        </div>
      </section>

      <div className="notice">
        <Icon name="shield" size={16} />
        <div>Keys are validated with the provider, encrypted at rest, and never returned to the browser.</div>
      </div>

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

function KeyForm({
  id,
  label,
  placeholder,
  value,
  show,
  pending,
  error,
  onChange,
  onToggle,
  onCancel,
  onSave,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  show: boolean;
  pending: boolean;
  error: string;
  onChange: (value: string) => void;
  onToggle: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div style={{ padding: "16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          className="input mono"
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
        />
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm input-action"
          onClick={onToggle}
          aria-label={show ? "Hide key" : "Show key"}
        >
          <Icon name={show ? "eye-off" : "eye"} size={14} />
        </button>
      </div>
      {error ? (
        <p className="validation-err" role="alert">
          <Icon name="alert" size={12} /> {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={pending || !value.trim()}>
          {pending ? <Icon name="loader" size={13} className="spin" /> : <Icon name="check" size={13} />}
          {pending ? "Validating…" : "Save key"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CredentialRow({
  credential,
  label,
  busy,
  onValidate,
  onDelete,
}: {
  credential: Credential;
  label: string;
  busy: boolean;
  onValidate: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const status = credential.status === "active" ? "Active" : credential.status === "invalid" ? "Rejected" : credential.status === "rate_limited" ? "Rate limited" : "Unverified";

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
          {status} · checked {shortDate(credential.lastValidatedAt)}
        </span>
      </div>
      <div className="key-actions">
        {confirming ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
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

function DefaultsPanel() {
  const { settings, updateSettings } = useStore();
  const [toast, setToast] = useState<string | null>(null);

  const save = (patch: Parameters<typeof updateSettings>[0], message: string) => {
    updateSettings(patch).then(() => setToast(message)).catch(() => setToast("Could not save"));
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>Answer defaults</h2>
            <p>Used when you start a new question.</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="field">
            <span className="label">Mode</span>
            <div className="segmented" style={{ width: "fit-content" }} role="group" aria-label="Default mode">
              {(["quick", "deep"] as Mode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={settings.defaultMode === mode}
                  onClick={() => save({ defaultMode: mode }, `${mode === "quick" ? "Quick" : "Deep"} is now the default`)}
                >
                  <Icon name={mode === "quick" ? "zap" : "layers"} size={12} />
                  {mode === "quick" ? "Quick" : "Deep"}
                </button>
              ))}
            </div>
            <p className="hint">Quick runs one search pass. Deep plans sub-queries and writes a longer report.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="llm-model">OpenRouter model</label>
            <select
              id="llm-model"
              className="select"
              value={settings.llmModel}
              onChange={(event) => save({ llmModel: event.target.value }, "Model updated")}
            >
              {OPENROUTER_MODELS.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="label">Search</span>
            <div className="input mono" style={{ display: "flex", alignItems: "center" }}>Brave Search · Web Search</div>
          </div>
        </div>
      </section>

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

function AccountPanel() {
  const router = useRouter();
  const { user, conversations, credentials, deleteAccount } = useStore();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const remove = async () => {
    if (confirm !== "DELETE" || pending) return;
    setPending(true);
    try {
      await deleteAccount();
      router.push("/");
    } catch {
      setToast("Could not delete the workspace");
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
        <div className="settings-card-body">
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
          <button type="button" className="btn btn-danger" disabled={confirm !== "DELETE" || pending} onClick={() => void remove()}>
            <Icon name="trash" size={14} /> Delete this workspace
          </button>
        </div>
      </section>

      <p className="hint">
        By using Beamling you agree to the <a href="/terms" style={{ color: "var(--accent)" }}>terms</a> and{" "}
        <a href="/privacy" style={{ color: "var(--accent)" }}>privacy policy</a>.
      </p>

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </div>
  );
}
