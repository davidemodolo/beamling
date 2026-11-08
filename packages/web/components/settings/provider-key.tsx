"use client";

import { useState, type FormEvent } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { credentialInput, EMPTY_LIMITS, limitsPayload, type CredentialLimitDraft } from "@/lib/credential-form";
import type { ProviderInfo } from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
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

/** One provider's key: its status row, and the forms to add, replace, limit, check or delete it. */
export function ProviderKey({ provider, onToast }: { provider: ProviderInfo; onToast: (message: string) => void }) {
  const { credentials, addCredential, removeCredential, validateCredential, updateCredentialLimits } = useAccount();
  const credential = credentials.find((item) => item.provider === provider.id);
  const [form, setForm] = useState<"key" | "limits" | null>(null);
  const [key, setKey] = useState("");
  const [validateNow, setValidateNow] = useState(true);
  const [limits, setLimits] = useState<CredentialLimitDraft>(EMPTY_LIMITS);
  const [pending, setPending] = useState(false);
  const [validating, setValidating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const id = `${provider.id}-key`;

  const open = (next: "key" | "limits") => {
    setForm(next);
    setKey("");
    setValidateNow(true);
    setLimits(limitsOf(credential));
    setError("");
  };
  const close = () => {
    setForm(null);
    setKey("");
    setError("");
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
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
      onToast(!provider.freeValidation && !validateNow ? `${provider.name} key saved, not validated` : `${provider.name} key saved`);
      close();
    } catch (cause) {
      setError(errorMessage(cause, `The provider rejected this ${provider.name} key.`));
    } finally {
      setPending(false);
    }
  };

  const saveLimits = async (event: FormEvent) => {
    event.preventDefault();
    if (!credential) return;
    setError("");
    try {
      await updateCredentialLimits(credential.id, limitsPayload(limits));
      onToast("Key limits updated");
      close();
    } catch (cause) {
      setError(errorMessage(cause, "Could not save the key limits."));
    }
  };

  const revalidate = async () => {
    if (!credential) return;
    setValidating(true);
    try {
      await validateCredential(credential.id);
      onToast("Key validated");
    } catch (cause) {
      onToast(errorMessage(cause, "Validation failed"));
    } finally {
      setValidating(false);
    }
  };

  const remove = async () => {
    if (!credential) return;
    setDeleting(true);
    try {
      await removeCredential(credential.id);
      onToast("Key deleted");
    } catch (cause) {
      onToast(errorMessage(cause, "Could not delete the key"));
    } finally {
      setDeleting(false);
    }
  };

  const errorLine = error ? (
    <p className="validation-err" role="alert">
      <Icon name="alert" size={12} /> {error}
    </p>
  ) : null;

  return (
    <div className="provider-key">
      {credential ? (
        <CredentialRow
          credential={credential}
          label={`${provider.name} key`}
          busy={validating}
          deleting={deleting}
          onValidate={() => void revalidate()}
          onDelete={() => void remove()}
          onLimits={provider.keyLimits ? () => open("limits") : undefined}
          onReplace={form ? undefined : () => open("key")}
        />
      ) : form !== "key" ? (
        <div className="key-card">
          <div className="key-main">
            <strong>No key yet</strong>
            <span>
              <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">
                Get a {provider.shortName} key <Icon name="external" size={11} />
              </a>
            </span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => open("key")}>
            <Icon name="plus" size={13} /> Add key
          </button>
        </div>
      ) : null}

      {form === "key" ? (
        <form className="key-form" onSubmit={saveKey}>
          <label className="label" htmlFor={id}>
            {provider.name} API key
          </label>
          <SecretKeyInput id={id} value={key} onChange={setKey} placeholder={provider.placeholder} invalid={!!error} />
          {provider.keyLimits ? <KeyLimitFields id={id} provider={provider} value={limits} onChange={setLimits} /> : null}
          {provider.freeValidation ? null : <ValidateNowField id={id} checked={validateNow} onChange={setValidateNow} />}
          {errorLine}
          <div className="key-form-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !key.trim()}>
              {pending ? <Icon name="loader" size={13} className="spin" /> : <Icon name="check" size={13} />}
              {pending ? (provider.freeValidation || validateNow ? "Validating…" : "Saving…") : "Save key"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {form === "limits" ? (
        <form className="key-form" onSubmit={saveLimits}>
          <KeyLimitFields id={`${provider.id}-limits`} provider={provider} value={limits} onChange={setLimits} />
          {errorLine}
          <div className="key-form-actions">
            <button type="submit" className="btn btn-primary btn-sm">
              Save limits
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
