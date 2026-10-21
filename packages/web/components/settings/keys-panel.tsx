"use client";

import { useState, type FormEvent } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { SEARCH_PROVIDERS } from "@/lib/providers";
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
  /** Checking the key spends a provider request, so saving without the check is offered. */
  paidValidation: boolean;
}[] = [
  {
    kind: "llm",
    provider: "openrouter",
    name: "OpenRouter",
    description: "Used for every answer.",
    inputId: "openrouter-key",
    placeholder: "sk-or-v1-...",
    paidValidation: false,
  },
  ...SEARCH_PROVIDERS.map((provider) => ({
    kind: "search" as const,
    provider: provider.id,
    name: provider.name,
    description: `Used when ${provider.name} is selected for an answer.`,
    inputId: `${provider.id}-key`,
    placeholder: provider.placeholder,
    paidValidation: !provider.freeValidation,
  })),
];

function LimitsForm({
  plan,
  expiry,
  budget,
  error,
  onPlan,
  onExpiry,
  onBudget,
  onCancel,
  onSave,
}: {
  plan: "free" | "paid";
  expiry: string;
  budget: string;
  error: string;
  onPlan: (value: "free" | "paid") => void;
  onExpiry: (value: string) => void;
  onBudget: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div style={{ padding: "16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <label className="label" htmlFor="brave-limits-plan">Brave plan</label>
      <select id="brave-limits-plan" className="select" value={plan} onChange={(event) => onPlan(event.target.value === "paid" ? "paid" : "free")}>
        <option value="free">Free · 1 request/second</option>
        <option value="paid">Paid / provider plan</option>
      </select>
      <label className="label" htmlFor="brave-limits-expiry">Key expiry (optional)</label>
      <input id="brave-limits-expiry" className="input" type="date" value={expiry} onChange={(event) => onExpiry(event.target.value)} />
      <label className="label" htmlFor="brave-limits-budget">Monthly budget in USD (optional)</label>
      <input id="brave-limits-budget" className="input" type="number" min="0.01" step="0.01" value={budget} onChange={(event) => onBudget(event.target.value)} placeholder="5.00" />
      {error ? <p className="validation-err" role="alert">{error}</p> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>Save limits</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function KeysPanel() {
  const { credentials, addCredential, removeCredential, validateCredential, updateCredentialLimits } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [validateNow, setValidateNow] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [limitsFor, setLimitsFor] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "paid">("free");
  const [expiry, setExpiry] = useState("");
  const [budget, setBudget] = useState("");
  const [limitsError, setLimitsError] = useState("");
  const [toast, showToast] = useToast();

  const credentialFor = (provider: (typeof PROVIDERS)[number]) =>
    credentials.find((item) => item.kind === provider.kind && item.provider === provider.provider);

  const start = (provider: (typeof PROVIDERS)[number]) => {
    const existing = credentialFor(provider);
    setEditing(provider.provider);
    setKey("");
    setValidateNow(true);
    setPlan(existing?.plan ?? "free");
    setExpiry(existing?.expiresOn ?? "");
    setBudget(existing?.budgetUsd?.toString() ?? "");
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
      await addCredential({
        kind: provider.kind,
        provider: provider.provider,
        key: value,
        plan: provider.provider === "brave" ? plan : undefined,
        expiresOn: provider.provider === "brave" && expiry ? expiry : null,
        budgetUsd: provider.provider === "brave" && budget ? Number(budget) : null,
        budgetPeriod: "month",
        validate: provider.paidValidation ? validateNow : true,
      });
      showToast(provider.paidValidation && !validateNow ? `${provider.name} key saved, not validated` : `${provider.name} key saved`);
      cancel();
    } catch (cause) {
      setError(errorMessage(cause, `The provider rejected this ${provider.name} key.`));
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

  const openLimits = (credential: Credential) => {
    setLimitsFor(credential.id);
    setPlan(credential.plan ?? "free");
    setExpiry(credential.expiresOn ?? "");
    setBudget(credential.budgetUsd?.toString() ?? "");
    setLimitsError("");
  };

  const saveLimits = async (credential: Credential) => {
    setLimitsError("");
    try {
      await updateCredentialLimits(credential.id, {
        plan,
        expiresOn: expiry || null,
        budgetUsd: budget ? Number(budget) : null,
        budgetPeriod: "month",
      });
      showToast("Key limits updated");
      setLimitsFor(null);
    } catch (cause) {
      setLimitsError(errorMessage(cause, "Could not save the key limits."));
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
        const credential = credentialFor(provider);
        return (
          <section className="settings-card" key={provider.provider}>
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2>{provider.name}</h2>
                <p>{provider.description}</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => start(provider)}>
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
                  onLimits={credential.provider === "brave" ? () => openLimits(credential) : undefined}
                />
              ) : (
                <p className="hint" style={{ padding: 18 }}>No {provider.name} key connected.</p>
              )}
              {limitsFor === credential?.id ? (
                <LimitsForm
                  plan={plan}
                  expiry={expiry}
                  budget={budget}
                  error={limitsError}
                  onPlan={setPlan}
                  onExpiry={setExpiry}
                  onBudget={setBudget}
                  onCancel={() => setLimitsFor(null)}
                  onSave={() => void saveLimits(credential)}
                />
              ) : null}
              {editing === provider.provider ? (
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
                  plan={plan}
                  expiry={expiry}
                  budget={budget}
                  showLimits={provider.provider === "brave"}
                  validateNow={provider.paidValidation ? validateNow : undefined}
                  onValidateNow={setValidateNow}
                  onPlan={setPlan}
                  onExpiry={setExpiry}
                  onBudget={setBudget}
                />
              ) : null}
            </div>
          </section>
        );
      })}

      <div className="notice">
        <Icon name="shield" size={16} />
        <div>
          Keys are validated with the provider unless you choose otherwise, encrypted at rest, and never returned to the
          browser.
        </div>
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
  plan,
  expiry,
  budget,
  showLimits,
  validateNow,
  onValidateNow,
  onPlan,
  onExpiry,
  onBudget,
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
  plan: "free" | "paid";
  expiry: string;
  budget: string;
  showLimits: boolean;
  /** Undefined when validation is free and always runs. */
  validateNow?: boolean;
  onValidateNow: (value: boolean) => void;
  onPlan: (value: "free" | "paid") => void;
  onExpiry: (value: string) => void;
  onBudget: (value: string) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending && value.trim()) onSave();
  };

  return (
    <form onSubmit={submit} style={{ padding: "16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <SecretKeyInput id={id} value={value} onChange={onChange} placeholder={placeholder} invalid={!!error} />
      {showLimits ? (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="label" htmlFor={`${id}-plan`}>Brave plan</label>
          <select id={`${id}-plan`} className="select" value={plan} onChange={(event) => onPlan(event.target.value === "paid" ? "paid" : "free")}>
            <option value="free">Free · 1 request/second</option>
            <option value="paid">Paid / provider plan</option>
          </select>
          <label className="label" htmlFor={`${id}-expiry`}>Key expiry (optional)</label>
          <input id={`${id}-expiry`} className="input" type="date" value={expiry} onChange={(event) => onExpiry(event.target.value)} />
          <label className="label" htmlFor={`${id}-budget`}>Monthly budget in USD (optional)</label>
          <input id={`${id}-budget`} className="input" type="number" min="0.01" step="0.01" value={budget} onChange={(event) => onBudget(event.target.value)} placeholder="5.00" />
          <p className="hint">Set on the Brave dashboard. Used only for warnings.</p>
        </div>
      ) : null}
      {validateNow !== undefined ? <ValidateNowField id={id} checked={validateNow} onChange={onValidateNow} /> : null}
      {error ? (
        <p className="validation-err" role="alert">
          <Icon name="alert" size={12} /> {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !value.trim()}>
          {pending ? <Icon name="loader" size={13} className="spin" /> : <Icon name="check" size={13} />}
          {pending ? (validateNow === false ? "Saving…" : "Validating…") : "Save key"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Opt-out for providers whose only key check is a billable search request. */
export function ValidateNowField({ id, checked, onChange }: { id: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div>
      <label className="check-row" htmlFor={`${id}-validate`}>
        <input id={`${id}-validate`} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        Validate the key now
      </label>
      <p className="hint">
        {checked
          ? "Checking runs one search request on your key."
          : "The key is saved as unverified. Use Validate in Settings to check it later; a wrong key fails at the first answer."}
      </p>
    </div>
  );
}
