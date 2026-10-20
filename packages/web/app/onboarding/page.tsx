"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Wordmark } from "@/components/wordmark";
import { DEFAULT_LLM_MODEL, OPENROUTER_MODELS } from "@/lib/providers";
import { useStore } from "@/lib/store";

export default function OnboardingPage() {
  const router = useRouter();
  const { addCredential, credentials, ready, updateSettings } = useStore();
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [llmKey, setLlmKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [pending, setPending] = useState(false);

  const hasLlm = credentials.some((credential) => credential.kind === "llm");
  const hasSearch = credentials.some((credential) => credential.kind === "search");

  const finish = async () => {
    if (pending) return;
    const nextLlm = llmKey.trim();
    const nextSearch = searchKey.trim();
    if (!hasLlm && nextLlm.length < 8) {
      setLlmError("Paste your OpenRouter key.");
      return;
    }
    if (!hasSearch && nextSearch.length < 8) {
      setSearchError("Paste your Brave Search key.");
      return;
    }
    setPending(true);
    setLlmError("");
    setSearchError("");
    try {
      if (nextLlm) {
        try {
          await addCredential({ kind: "llm", provider: "openrouter", key: nextLlm });
        } catch (cause) {
          setLlmError(cause instanceof Error ? cause.message : "OpenRouter rejected this key.");
          setPending(false);
          return;
        }
      }
      if (nextSearch) {
        try {
          await addCredential({ kind: "search", provider: "brave", key: nextSearch });
        } catch (cause) {
          setSearchError(cause instanceof Error ? cause.message : "Brave rejected this key.");
          setPending(false);
          return;
        }
      }
      await updateSettings({ llmModel, defaultMode: "quick" });
      router.push("/chat");
    } catch {
      setPending(false);
    }
  };

  return (
    <div className="onboard-shell">
      <header className="onboard-top">
        <Wordmark href="/chat" />
        <span style={{ flex: 1 }} />
        {hasLlm && hasSearch ? (
          <Link href="/chat" className="btn btn-ghost btn-sm">Back to chat</Link>
        ) : null}
      </header>

      <main className="onboard-main">
        <div className="onboard-step">
          <span className="badge badge-beam" style={{ width: "fit-content" }}>Setup</span>
          <h1>Connect your keys</h1>
          <p className="lead">
            Beamling runs on your own OpenRouter and Brave Search keys. They are validated once, encrypted at rest, and
            never returned to the browser.
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
                    rel="noreferrer"
                  >
                    Get a key
                  </a>
                </label>
                <div className="input-wrap">
                  <input
                    id="llm-key"
                    className="input mono"
                    type={showLlmKey ? "text" : "password"}
                    value={llmKey}
                    onChange={(event) => {
                      setLlmKey(event.target.value);
                      setLlmError("");
                    }}
                    placeholder={hasLlm ? "Connected · paste a new key to replace it" : "sk-or-v1-..."}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!llmError}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm input-action"
                    onClick={() => setShowLlmKey((shown) => !shown)}
                    aria-label={showLlmKey ? "Hide key" : "Show key"}
                  >
                    <Icon name={showLlmKey ? "eye-off" : "eye"} size={14} />
                  </button>
                </div>
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
                <select id="llm-model" className="select" value={llmModel} onChange={(event) => setLlmModel(event.target.value)}>
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
                <h2>Brave Search</h2>
                <p>Web Search plan key, used for retrieval.</p>
              </div>
              {hasSearch ? <span className="badge badge-success">Connected</span> : null}
            </div>
            <div className="settings-card-body">
              <div className="field">
                <label className="label" htmlFor="search-key">
                  API key
                  <a
                    className="btn btn-ghost btn-sm"
                    href="https://api-dashboard.search.brave.com/app/keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get a key
                  </a>
                </label>
                <div className="input-wrap">
                  <input
                    id="search-key"
                    className="input mono"
                    type={showSearchKey ? "text" : "password"}
                    value={searchKey}
                    onChange={(event) => {
                      setSearchKey(event.target.value);
                      setSearchError("");
                    }}
                    placeholder={hasSearch ? "Connected · paste a new key to replace it" : "BSA..."}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!searchError}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm input-action"
                    onClick={() => setShowSearchKey((shown) => !shown)}
                    aria-label={showSearchKey ? "Hide key" : "Show key"}
                  >
                    <Icon name={showSearchKey ? "eye-off" : "eye"} size={14} />
                  </button>
                </div>
                {searchError ? (
                  <p className="validation-err" role="alert">
                    <Icon name="alert" size={12} /> {searchError}
                  </p>
                ) : (
                  <p className="hint">Validated with one minimal request.</p>
                )}
              </div>
            </div>
          </section>

          <div className="onboard-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void finish()} disabled={pending || !ready}>
              {pending ? <Icon name="loader" size={15} className="spin" /> : <Icon name="sparkles" size={15} />}
              {pending ? "Validating…" : "Start asking"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
