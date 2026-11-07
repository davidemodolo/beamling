"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { KeyLimitFields, ValidateNowField } from "@/components/settings/key-fields";
import { Icon } from "@/components/ui/icon";
import { Wordmark } from "@/components/wordmark";
import { WorkspaceError } from "@/components/workspace-error";
import { errorMessage } from "@/lib/api";
import { isSearchProvider } from "@/lib/contracts";
import { credentialInput, EMPTY_LIMITS, type CredentialLimitDraft } from "@/lib/credential-form";
import { MODEL_GROUPS, SEARCH_PROVIDERS, modelProvider, providerInfo, type ProviderInfo } from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
import type { SearchProvider } from "@/lib/types";

/** One provider key field: connected state, key link, notice and the free-check hint. */
function KeyField({
  id,
  provider,
  connected,
  value,
  error,
  onChange,
}: {
  id: string;
  provider: ProviderInfo;
  connected: boolean;
  value: string;
  error: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {provider.name} API key
        <a className="btn btn-ghost btn-sm" href={provider.keyUrl} target="_blank" rel="noopener noreferrer">
          Get a key
        </a>
      </label>
      <SecretKeyInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={connected ? "Connected · paste a new key to replace it" : provider.placeholder}
        invalid={!!error}
      />
      {error ? (
        <p className="validation-err" role="alert">
          <Icon name="alert" size={12} /> {error}
        </p>
      ) : provider.freeValidation ? (
        <p className="hint">Checked with {provider.name} without spending credit.</p>
      ) : null}
      {provider.notice ? (
        <div className="notice">
          <Icon name="alert" size={16} />
          <div>{provider.notice}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { addCredential, credentials, ready, settings, updateSettings, error, user } = useAccount();
  // Null until the user changes it: the control shows the saved values and nothing else is changed.
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [pickedProvider, setPickedProvider] = useState<SearchProvider | null>(null);
  const llmModel = pickedModel ?? settings.llmModel;
  const searchProvider = pickedProvider ?? settings.defaultSearchProvider;
  const llmProvider = providerInfo(modelProvider(llmModel));
  const searchInfo = providerInfo(searchProvider);
  // One provider can run both the model and search; its key is asked for once.
  const sharedKey = (searchProvider as string) === llmProvider.id;
  const [llmKey, setLlmKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [validateSearch, setValidateSearch] = useState(true);
  const [limits, setLimits] = useState<CredentialLimitDraft>(EMPTY_LIMITS);
  const [llmError, setLlmError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);

  const keyed = new Set(credentials.map((credential) => credential.provider));
  const hasLlm = keyed.has(llmProvider.id);
  const hasSearch = keyed.has(searchProvider);
  const hasAnySearch = credentials.some((credential) => isSearchProvider(credential.provider));

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const nextLlm = llmKey.trim();
    const nextSearch = sharedKey ? "" : searchKey.trim();
    if (!hasLlm && nextLlm.length < 8) {
      setLlmError(`Paste your ${llmProvider.name} key.`);
      return;
    }
    if (!sharedKey && !hasSearch && nextSearch.length < 8) {
      setSearchError(`Paste your ${searchInfo.name} key.`);
      return;
    }
    setPending(true);
    setLlmError("");
    setSearchError("");
    setFormError("");
    // Saved keys are cleared from the form, so a retry after a later failure doesn't re-submit them.
    if (nextLlm) {
      try {
        await addCredential(credentialInput(llmProvider.id, nextLlm));
        setLlmKey("");
      } catch (cause) {
        setLlmError(errorMessage(cause, `${llmProvider.name} rejected this key.`));
        setPending(false);
        return;
      }
    }
    if (nextSearch) {
      try {
        await addCredential(credentialInput(searchProvider, nextSearch, { limits, validateNow: validateSearch }));
        setSearchKey("");
      } catch (cause) {
        setSearchError(errorMessage(cause, `${searchInfo.name} rejected this key.`));
        setPending(false);
        return;
      }
    }
    try {
      const patch: Parameters<typeof updateSettings>[0] = {};
      if (pickedModel && pickedModel !== settings.llmModel) patch.llmModel = pickedModel;
      if (searchProvider !== settings.defaultSearchProvider) patch.defaultSearchProvider = searchProvider;
      if (Object.keys(patch).length) await updateSettings(patch);
    } catch (cause) {
      setFormError(`Your keys are saved, but the defaults could not be saved. ${errorMessage(cause, "Try again.")}`);
      setPending(false);
      return;
    }
    router.push("/chat");
  };

  if (error && !user) {
    return (
      <div className="onboard-shell">
        <header className="onboard-top">
          <Wordmark href="/chat" />
        </header>
        <main className="onboard-main">
          <WorkspaceError message={error} />
        </main>
      </div>
    );
  }

  const checking = sharedKey || searchInfo.freeValidation || validateSearch;

  return (
    <div className="onboard-shell">
      <header className="onboard-top">
        <Wordmark href="/chat" />
        <span style={{ flex: 1 }} />
        {hasLlm && hasAnySearch ? (
          <Link href="/chat" className="btn btn-ghost btn-sm">Back to chat</Link>
        ) : null}
      </header>

      <main className="onboard-main">
        <form className="onboard-step" onSubmit={(event) => void finish(event)} noValidate>
          <span className="badge badge-beam" style={{ width: "fit-content" }}>Setup</span>
          <h1>Connect your keys</h1>
          <p className="lead">
            Beamling runs on your own model and search-provider keys. They are validated once, encrypted at rest, and
            never returned to the browser.
          </p>

          <section className="settings-card">
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2>Language model</h2>
                <p>Writes every answer. You can change it later in Settings.</p>
              </div>
              {hasLlm ? <span className="badge badge-success">Connected</span> : null}
            </div>
            <div className="settings-card-body">
              <div className="field">
                <label className="label" htmlFor="llm-model">Default model</label>
                <select
                  id="llm-model"
                  className="select"
                  value={llmModel}
                  disabled={!ready}
                  onChange={(event) => {
                    setPickedModel(event.target.value);
                    setLlmKey("");
                    setLlmError("");
                  }}
                >
                  {MODEL_GROUPS.map(({ provider, models }) => (
                    <optgroup key={provider.id} label={provider.name}>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>{model.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <KeyField
                id="llm-key"
                provider={llmProvider}
                connected={hasLlm}
                value={llmKey}
                error={llmError}
                onChange={(value) => {
                  setLlmKey(value);
                  setLlmError("");
                }}
              />
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2>Web search</h2>
                <p>Choose the provider used for retrieval. You can change it per answer later.</p>
              </div>
              {hasSearch ? <span className="badge badge-success">Connected</span> : null}
            </div>
            <div className="settings-card-body">
              <div className="field">
                <label className="label" htmlFor="search-provider">Search provider</label>
                <select
                  id="search-provider"
                  className="select"
                  value={searchProvider}
                  onChange={(event) => {
                    if (!isSearchProvider(event.target.value)) return;
                    setPickedProvider(event.target.value);
                    setSearchKey("");
                    setSearchError("");
                  }}
                >
                  {SEARCH_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
              {sharedKey ? (
                <p className="hint">Uses your {searchInfo.name} key from above.</p>
              ) : (
                <>
                  <KeyField
                    id="search-key"
                    provider={searchInfo}
                    connected={hasSearch}
                    value={searchKey}
                    error={searchError}
                    onChange={(value) => {
                      setSearchKey(value);
                      setSearchError("");
                    }}
                  />
                  {searchInfo.freeValidation ? null : (
                    <ValidateNowField id="search-key" checked={validateSearch} onChange={setValidateSearch} />
                  )}
                </>
              )}
              {!sharedKey && searchInfo.keyLimits ? (
                <KeyLimitFields id="search-key" provider={searchInfo} value={limits} onChange={setLimits} />
              ) : null}
            </div>
          </section>

          {formError ? (
            <p className="validation-err" role="alert">
              <Icon name="alert" size={12} /> {formError}
            </p>
          ) : null}

          <div className="onboard-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={pending || !ready}>
              {pending ? <Icon name="loader" size={15} className="spin" /> : <Icon name="sparkles" size={15} />}
              {pending ? (checking ? "Validating…" : "Saving…") : "Start asking"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
