"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { KeyLimitFields, ValidateNowField } from "@/components/settings/key-fields";
import { Icon } from "@/components/ui/icon";
import { Wordmark } from "@/components/wordmark";
import { WorkspaceError } from "@/components/workspace-error";
import { errorMessage } from "@/lib/api";
import { isSearchProvider } from "@/lib/contracts";
import { credentialInput, EMPTY_LIMITS, type CredentialLimitDraft } from "@/lib/credential-form";
import {
  FREE_LLM_MODEL,
  MODEL_GROUPS,
  SEARCH_PROVIDERS,
  llmModelName,
  modelProvider,
  providerInfo,
  usableProviders,
  type ProviderInfo,
} from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
import type { SearchProvider } from "@/lib/types";

type Path = "free" | "custom";
type Step = "path" | "model" | "search";

const FREE_SEARCH: SearchProvider = "brave";

/** One provider key field: connected state, key link, an explanation and the provider's notice. */
function KeyField({
  id,
  provider,
  connected,
  value,
  error,
  onChange,
  children,
}: {
  id: string;
  provider: ProviderInfo;
  connected: boolean;
  value: string;
  error: string;
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {provider.name} API key
        <a className="btn btn-ghost btn-sm" href={provider.keyUrl} target="_blank" rel="noopener noreferrer">
          Get a key <Icon name="arrow-right" size={12} />
        </a>
      </label>
      <SecretKeyInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={connected ? "Saved · paste a new key to replace it" : provider.placeholder}
        invalid={!!error}
      />
      {error ? (
        <p className="validation-err" role="alert">
          <Icon name="alert" size={12} /> {error}
        </p>
      ) : connected ? (
        <p className="hint">
          <Icon name="check" size={12} /> Key saved.
        </p>
      ) : provider.freeValidation ? (
        <p className="hint">Checked for free.</p>
      ) : null}
      {children}
      {provider.notice ? (
        <div className="notice">
          <Icon name="alert" size={16} />
          <div>{provider.notice}</div>
        </div>
      ) : null}
    </div>
  );
}

function StepHeader({ index, title, lead }: { index: 1 | 2; title: string; lead: ReactNode }) {
  return (
    <>
      <div className="onboard-progress" aria-label={`Step ${index} of 2`}>
        <span className={index >= 1 ? "on" : undefined} />
        <span className={index >= 2 ? "on" : undefined} />
        <small>Step {index} of 2</small>
      </div>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
    </>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { addCredential, credentials, ready, settings, updateSettings, error, user } = useAccount();
  const keyed = usableProviders(credentials);
  const hasModelKey = MODEL_GROUPS.some(({ provider }) => keyed.has(provider.id));

  // A returning user who already saved a model key continues with search.
  const [pickedStep, setStep] = useState<Step | null>(null);
  const step: Step = pickedStep ?? (hasModelKey ? "search" : "path");
  const [path, setPath] = useState<Path>("custom");
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [pickedSearch, setPickedSearch] = useState<SearchProvider | null>(null);
  const llmModel = path === "free" ? FREE_LLM_MODEL : (pickedModel ?? settings.llmModel);
  const searchProvider = path === "free" ? FREE_SEARCH : (pickedSearch ?? settings.defaultSearchProvider);
  const llmInfo = providerInfo(modelProvider(llmModel));
  const searchInfo = providerInfo(searchProvider);
  // One DeepSeek key runs both the model and search.
  const sharedKey = (searchProvider as string) === llmInfo.id;

  const [key, setKey] = useState("");
  const [validateSearch, setValidateSearch] = useState(true);
  const [limits, setLimits] = useState<CredentialLimitDraft>(EMPTY_LIMITS);
  const [fieldError, setFieldError] = useState("");
  const [pending, setPending] = useState(false);

  const go = (next: Step) => {
    setStep(next);
    setKey("");
    setFieldError("");
  };

  /** Saves the typed key, if any. Returns false when the key is missing or rejected. */
  const saveKey = async (provider: ProviderInfo, options?: Parameters<typeof credentialInput>[2]) => {
    const typed = key.trim();
    if (!typed) {
      if (keyed.has(provider.id)) return true;
      setFieldError(`Paste your ${provider.name} key.`);
      return false;
    }
    if (typed.length < 8) {
      setFieldError(`This does not look like a ${provider.name} key.`);
      return false;
    }
    try {
      await addCredential(credentialInput(provider.id, typed, options));
      setKey("");
      return true;
    } catch (cause) {
      setFieldError(errorMessage(cause, `${provider.name} rejected this key.`));
      return false;
    }
  };

  const finish = async () => {
    await updateSettings({ llmModel, defaultSearchProvider: searchProvider });
    router.push("/");
  };

  const submitModel = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFieldError("");
    try {
      if (!(await saveKey(llmInfo))) return;
      // Saved now, so leaving between the steps keeps the chosen model.
      if (llmModel !== settings.llmModel) await updateSettings({ llmModel });
      if (sharedKey) await finish();
      else go("search");
    } catch (cause) {
      setFieldError(errorMessage(cause, "Your key is saved, but the model could not be saved. Try again."));
    } finally {
      setPending(false);
    }
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFieldError("");
    try {
      if (!sharedKey && !(await saveKey(searchInfo, { limits, validateNow: validateSearch }))) return;
      await finish();
    } catch (cause) {
      setFieldError(errorMessage(cause, "Your key is saved, but the defaults could not be saved. Try again."));
    } finally {
      setPending(false);
    }
  };

  if (error && !user) {
    return (
      <div className="onboard-shell">
        <header className="onboard-top">
          <Wordmark href="/" />
        </header>
        <main className="onboard-main">
          <WorkspaceError message={error} />
        </main>
      </div>
    );
  }

  const busyLabel = (checking: boolean) => (checking ? "Checking the key…" : "Saving…");

  return (
    <div className="onboard-shell">
      <header className="onboard-top">
        <Wordmark href="/" />
      </header>

      <main className="onboard-main">
        {step === "path" ? (
          <section className="onboard-step" aria-labelledby="setup-title">
            <span className="badge badge-beam" style={{ width: "fit-content" }}>Setup</span>
            <h1 id="setup-title">How do you want to start?</h1>
            <p className="lead">Beamling runs on your own keys. They are encrypted and never shown again.</p>
            <div className="onboard-paths">
              <button
                type="button"
                className="onboard-path"
                onClick={() => {
                  setPath("free");
                  go("model");
                }}
              >
                <span className="badge badge-success">Recommended</span>
                <strong>Quick setup</strong>
                <span>An OpenRouter free model and Brave Search.</span>
                <span className="onboard-path-go">
                  Set up <Icon name="arrow-right" size={13} />
                </span>
              </button>
              <button
                type="button"
                className="onboard-path"
                onClick={() => {
                  setPath("custom");
                  go("model");
                }}
              >
                <strong>Use my own providers</strong>
                <span>Claude, GPT, Gemini, DeepSeek and more.</span>
                <span className="onboard-path-go">
                  Choose providers <Icon name="arrow-right" size={13} />
                </span>
              </button>
            </div>
          </section>
        ) : step === "model" ? (
          <form className="onboard-step" onSubmit={(event) => void submitModel(event)} noValidate>
            <StepHeader
              index={1}
              title={path === "free" ? "Connect OpenRouter" : "Choose your model"}
              lead={
                path === "free" ? (
                  "Create an OpenRouter key."
                ) : (
                  "You can change it later in Settings."
                )
              }
            />
            {path === "free" ? (
              <div className="onboard-pick">
                <Icon name="sparkles" size={16} />
                <div>
                  <strong>{llmModelName(llmModel)}</strong>
                  <span>Listed as free on OpenRouter</span>
                </div>
              </div>
            ) : (
              <div className="field">
                <label className="label" htmlFor="llm-model">Model</label>
                <select
                  id="llm-model"
                  className="select"
                  value={llmModel}
                  disabled={!ready}
                  onChange={(event) => {
                    setPickedModel(event.target.value);
                    setKey("");
                    setFieldError("");
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
            )}
            <KeyField
              id="llm-key"
              provider={llmInfo}
              connected={keyed.has(llmInfo.id)}
              value={key}
              error={fieldError}
              onChange={(value) => {
                setKey(value);
                setFieldError("");
              }}
            >
              {path === "free" ? (
                <p className="hint">Limits and data use follow OpenRouter&apos;s terms.</p>
              ) : null}
            </KeyField>
            <div className="onboard-actions">
              <button type="submit" className="btn btn-primary btn-lg" disabled={pending || !ready}>
                {pending ? <Icon name="loader" size={15} className="spin" /> : null}
                {pending ? busyLabel(!!key.trim()) : sharedKey ? "Start asking" : "Continue"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => go("path")} disabled={pending}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <form className="onboard-step" onSubmit={(event) => void submitSearch(event)} noValidate>
            <StepHeader
              index={2}
              title={path === "free" ? "Connect Brave Search" : "Choose your search provider"}
              lead={
                path === "free" ? (
                  "Create a key on Brave's Search plan."
                ) : (
                  "You can switch provider per question."
                )
              }
            />
            {path === "free" ? null : (
              <div className="field">
                <label className="label" htmlFor="search-provider">Search provider</label>
                <select
                  id="search-provider"
                  className="select"
                  value={searchProvider}
                  onChange={(event) => {
                    if (!isSearchProvider(event.target.value)) return;
                    setPickedSearch(event.target.value);
                    setKey("");
                    setFieldError("");
                  }}
                >
                  {SEARCH_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                      {keyed.has(provider.id) ? " · key saved" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {sharedKey ? (
              <p className="hint">Uses your {searchInfo.name} key.</p>
            ) : (
              <>
                <KeyField
                  id="search-key"
                  provider={searchInfo}
                  connected={keyed.has(searchInfo.id)}
                  value={key}
                  error={fieldError}
                  onChange={(value) => {
                    setKey(value);
                    setFieldError("");
                  }}
                />
                {searchInfo.freeValidation || !key.trim() ? null : (
                  <ValidateNowField id="search-key" checked={validateSearch} onChange={setValidateSearch} />
                )}
                {searchInfo.keyLimits && key.trim() ? (
                  <details className="onboard-more">
                    <summary>Plan, expiry and budget</summary>
                    <KeyLimitFields id="search-key" provider={searchInfo} value={limits} onChange={setLimits} />
                  </details>
                ) : null}
              </>
            )}
            {sharedKey && fieldError ? (
              <p className="validation-err" role="alert">
                <Icon name="alert" size={12} /> {fieldError}
              </p>
            ) : null}
            <div className="onboard-actions">
              <button type="submit" className="btn btn-primary btn-lg" disabled={pending || !ready}>
                {pending ? <Icon name="loader" size={15} className="spin" /> : <Icon name="sparkles" size={15} />}
                {pending ? busyLabel(!!key.trim() && (searchInfo.freeValidation || validateSearch)) : "Start asking"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => go("model")} disabled={pending}>
                Back
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
