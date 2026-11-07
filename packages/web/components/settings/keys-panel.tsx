"use client";

import { useState, type FormEvent } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { isCredentialProvider } from "@/lib/contracts";
import { ALL_PROVIDERS, providerUses, type ProviderInfo } from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
import { credentialInput, EMPTY_LIMITS, limitsPayload, type CredentialLimitDraft } from "@/lib/credential-form";
import type { Credential } from "@/lib/types";
import { CredentialRow } from "./credential-row";
import { KeyLimitFields, ValidateNowField } from "./key-fields";

function limitsOf(credential: Credential | undefined): CredentialLimitDraft {
  return {
    plan: credential?.plan ?? "free",
    expiresOn: credential?.expiresOn ?? "",
    budgetUsd: credential?.budgetUsd?.toString() ?? "",
  };
}

function LimitsForm({
  provider,
  limits,
  error,
  onLimits,
  onCancel,
  onSave,
}: {
  provider: ProviderInfo;
  limits: CredentialLimitDraft;
  error: string;
  onLimits: (value: CredentialLimitDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div style={{ padding: "16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <KeyLimitFields id={`${provider.id}-limits`} provider={provider} value={limits} onChange={onLimits} />
      {error ? <p className="validation-err" role="alert">{error}</p> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>Save limits</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function KeysPanel() {
  const { credentials, addCredential, removeCredential, validateCredential, updateCredentialLimits } = useAccount();
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [validateNow, setValidateNow] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [limitsFor, setLimitsFor] = useState<string | null>(null);
  // Shared by the key form and the limits form; only one is open per provider at a time.
  const [limits, setLimits] = useState<CredentialLimitDraft>(EMPTY_LIMITS);
  const [limitsError, setLimitsError] = useState("");
  const [toast, showToast] = useToast();

  const credentialFor = (provider: ProviderInfo) => credentials.find((item) => item.provider === provider.id);
  // Keys for providers that were removed from the catalog: they can only be deleted.
  const retired = credentials.filter((item) => !isCredentialProvider(item.provider));

  const start = (provider: ProviderInfo) => {
    setEditing(provider.id);
    setKey("");
    setValidateNow(true);
    setLimits(limitsOf(credentialFor(provider)));
    setError("");
  };

  const cancel = () => {
    setEditing(null);
    setKey("");
    setError("");
  };

  const save = async (provider: ProviderInfo) => {
    if (pending) return;
    const value = key.trim();
    if (value.length < 8) {
      setError("Paste the full key and try again.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await addCredential(credentialInput(provider.id, value, { limits, validateNow }));
      showToast(!provider.freeValidation && !validateNow ? `${provider.name} key saved, not validated` : `${provider.name} key saved`);
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
    setLimits(limitsOf(credential));
    setLimitsError("");
  };

  const saveLimits = async (credential: Credential) => {
    setLimitsError("");
    try {
      await updateCredentialLimits(credential.id, limitsPayload(limits));
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
      {ALL_PROVIDERS.map((provider) => {
        const credential = credentialFor(provider);
        return (
          <section className="settings-card" key={provider.id}>
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2>{provider.name}</h2>
                <p>
                  {providerUses(provider.id)} ·{" "}
                  <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">
                    Get a key
                  </a>
                </p>
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
                  onLimits={provider.keyLimits ? () => openLimits(credential) : undefined}
                />
              ) : (
                <p className="hint" style={{ padding: 18 }}>No {provider.name} key connected.</p>
              )}
              {limitsFor === credential?.id ? (
                <LimitsForm
                  provider={provider}
                  limits={limits}
                  error={limitsError}
                  onLimits={setLimits}
                  onCancel={() => setLimitsFor(null)}
                  onSave={() => void saveLimits(credential)}
                />
              ) : null}
              {provider.notice ? (
                <div className="notice" style={{ margin: "0 18px 16px" }}>
                  <Icon name="alert" size={16} />
                  <div>{provider.notice}</div>
                </div>
              ) : null}
              {editing === provider.id ? (
                <KeyForm
                  id={`${provider.id}-key`}
                  provider={provider}
                  value={key}
                  pending={pending}
                  error={error}
                  onChange={setKey}
                  onCancel={cancel}
                  onSave={() => void save(provider)}
                  limits={limits}
                  onLimits={setLimits}
                  validateNow={provider.freeValidation ? undefined : validateNow}
                  onValidateNow={setValidateNow}
                />
              ) : null}
            </div>
          </section>
        );
      })}

      {retired.map((credential) => (
        <section className="settings-card" key={credential.id}>
          <div className="settings-card-head">
            <div style={{ flex: 1 }}>
              <h2>{credential.provider}</h2>
              <p>Beamling no longer supports this provider. Delete the key.</p>
            </div>
          </div>
          <div className="settings-card-body tight">
            <CredentialRow
              credential={credential}
              label={credential.provider}
              busy={false}
              deleting={deleting === credential.id}
              onDelete={() => void remove(credential)}
            />
          </div>
        </section>
      ))}

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
  provider,
  value,
  pending,
  error,
  onChange,
  onCancel,
  onSave,
  limits,
  onLimits,
  validateNow,
  onValidateNow,
}: {
  id: string;
  provider: ProviderInfo;
  value: string;
  pending: boolean;
  error: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  limits: CredentialLimitDraft;
  onLimits: (value: CredentialLimitDraft) => void;
  /** Undefined when validation is free and always runs. */
  validateNow?: boolean;
  onValidateNow: (value: boolean) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending && value.trim()) onSave();
  };

  return (
    <form onSubmit={submit} style={{ padding: "16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <label className="label" htmlFor={id}>{provider.name} API key</label>
      <SecretKeyInput id={id} value={value} onChange={onChange} placeholder={provider.placeholder} invalid={!!error} />
      {provider.keyLimits ? <KeyLimitFields id={id} provider={provider} value={limits} onChange={onLimits} /> : null}
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
