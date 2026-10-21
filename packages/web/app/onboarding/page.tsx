"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SecretKeyInput } from "@/components/secret-key-input";
import { Icon } from "@/components/ui/icon";
import { Wordmark } from "@/components/wordmark";
import { WorkspaceError } from "@/components/workspace-error";
import { errorMessage } from "@/lib/api";
import { OPENROUTER_MODELS, SEARCH_PROVIDERS, searchProviderInfo } from "@/lib/providers";
import { useStore } from "@/lib/store";
import type { SearchProvider } from "@/lib/types";

export default function OnboardingPage() {
  const router = useRouter();
  const { addCredential, credentials, ready, settings, updateSettings, error, user } = useStore();
  // Null until the user changes it: the control shows the saved values and nothing else is changed.
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [pickedProvider, setPickedProvider] = useState<SearchProvider | null>(null);
  const llmModel = pickedModel ?? settings.llmModel;
  const searchProvider = pickedProvider ?? settings.defaultSearchProvider;
  const providerInfo = searchProviderInfo(searchProvider);
  const [llmKey, setLlmKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [bravePlan, setBravePlan] = useState<"free" | "paid">("free");
  const [expiresOn, setExpiresOn] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("");
  const [llmError, setLlmError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);

  const hasLlm = credentials.some((credential) => credential.kind === "llm");
  const hasSearch = credentials.some(
    (credential) => credential.kind === "search" && credential.provider === searchProvider,
  );
  const hasAnySearch = credentials.some((credential) => credential.kind === "search");

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const nextLlm = llmKey.trim();
    const nextSearch = searchKey.trim();
    if (!hasLlm && nextLlm.length < 8) {
      setLlmError("Paste your OpenRouter key.");
      return;
    }
    if (!hasSearch && nextSearch.length < 8) {
      setSearchError(`Paste your ${providerInfo.name} key.`);
      return;
    }
    setPending(true);
    setLlmError("");
    setSearchError("");
    setFormError("");
    // Saved keys are cleared from the form, so a retry after a later failure doesn't re-submit them.
    if (nextLlm) {
      try {
        await addCredential({ kind: "llm", provider: "openrouter", key: nextLlm });
        setLlmKey("");
      } catch (cause) {
        setLlmError(errorMessage(cause, "OpenRouter rejected this key."));
        setPending(false);
        return;
      }
    }
    if (nextSearch) {
      try {
        await addCredential({
          kind: "search",
          provider: searchProvider,
          key: nextSearch,
          plan: searchProvider === "brave" ? bravePlan : undefined,
          expiresOn: searchProvider === "brave" && expiresOn ? expiresOn : null,
          budgetUsd: searchProvider === "brave" && budgetUsd ? Number(budgetUsd) : null,
          budgetPeriod: "month",
        });
        setSearchKey("");
      } catch (cause) {
        setSearchError(errorMessage(cause, `${providerInfo.name} rejected this key.`));
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
            Beamling runs on your own OpenRouter and search-provider keys. They are validated once, encrypted at rest,
            and never returned to the browser.
          </p>

          <section className="settings-card">
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2>OpenRouter</h2>
                <p>Language model for every answer.</p>
              </div>
              {hasLlm ? <span className="badge badge-success">Connected</span> : null}
            </div>
            <div className="settings-card-body">
              <div className="field">
                <label className="label" htmlFor="llm-key">
                  API key
                  <a
                    className="btn btn-ghost btn-sm"
                    href="https://openrouter.ai/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get a key
                  </a>
                </label>
                <SecretKeyInput
                  id="llm-key"
                  value={llmKey}
                  onChange={(value) => {
                    setLlmKey(value);
                    setLlmError("");
                  }}
                  placeholder={hasLlm ? "Connected · paste a new key to replace it" : "sk-or-v1-..."}
                  invalid={!!llmError}
                />
                {llmError ? (
                  <p className="validation-err" role="alert">
                    <Icon name="alert" size={12} /> {llmError}
                  </p>
                ) : (
                  <p className="hint">Validated without spending tokens.</p>
                )}
              </div>
              <div className="field">
                <label className="label" htmlFor="llm-model">Default model</label>
                <select
                  id="llm-model"
                  className="select"
                  value={llmModel}
                  disabled={!ready}
                  onChange={(event) => setPickedModel(event.target.value)}
                >
                  {OPENROUTER_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </div>
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
                    setPickedProvider(event.target.value as SearchProvider);
                    setSearchKey("");
                    setSearchError("");
                  }}
                >
                  {SEARCH_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="search-key">
                  {providerInfo.name} API key
                  <a
                    className="btn btn-ghost btn-sm"
                    href={providerInfo.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get a key
                  </a>
                </label>
                <SecretKeyInput
                  id="search-key"
                  value={searchKey}
                  onChange={(value) => {
                    setSearchKey(value);
                    setSearchError("");
                  }}
                  placeholder={hasSearch ? "Connected · paste a new key to replace it" : providerInfo.placeholder}
                  invalid={!!searchError}
                />
                {searchError ? (
                  <p className="validation-err" role="alert">
                    <Icon name="alert" size={12} /> {searchError}
                  </p>
                ) : (
                  <p className="hint">Validated with one minimal request.</p>
                )}
              </div>
              {searchProvider === "brave" ? (
                <>
                  <div className="field">
                    <label className="label" htmlFor="brave-plan">Brave plan</label>
                    <select
                      id="brave-plan"
                      className="select"
                      value={bravePlan}
                      onChange={(event) => setBravePlan(event.target.value === "paid" ? "paid" : "free")}
                    >
                      <option value="free">Free · 1 request/second</option>
                      <option value="paid">Paid / provider plan</option>
                    </select>
                    <p className="hint">We ask because Brave&apos;s API does not expose the key plan.</p>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="brave-expiry">Key expiry (optional)</label>
                    <input
                      id="brave-expiry"
                      className="input"
                      type="date"
                      value={expiresOn}
                      onChange={(event) => setExpiresOn(event.target.value)}
                    />
                    <p className="hint">Set on the Brave dashboard. Used only for warnings.</p>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="brave-budget">Monthly budget in USD (optional)</label>
                    <input
                      id="brave-budget"
                      className="input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={budgetUsd}
                      onChange={(event) => setBudgetUsd(event.target.value)}
                      placeholder="5.00"
                    />
                    <p className="hint">Also set on the Brave dashboard. Beamling estimates spend from request counts.</p>
                  </div>
                </>
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
              {pending ? "Validating…" : "Start asking"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
