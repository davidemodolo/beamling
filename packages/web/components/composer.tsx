"use client";

import { useEffect, type RefObject } from "react";
import { Icon } from "./ui/icon";
import { MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";
import { SEARCH_PROVIDERS } from "@/lib/provider-catalog";
import type { Mode, SearchProvider } from "@/lib/types";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  /** A stop was requested and is waiting for the server to confirm. */
  stopping?: boolean;
  /** The workspace is not ready (still loading, or the conversation does not exist). */
  disabled?: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  searchProvider: SearchProvider;
  /** Providers with a saved key; the others are listed but marked. */
  keyedProviders: ReadonlySet<string>;
  onSearchProviderChange: (provider: SearchProvider) => void;
  modelLabel: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  stopping = false,
  disabled = false,
  mode,
  onModeChange,
  searchProvider,
  keyedProviders,
  onSearchProviderChange,
  modelLabel,
  inputRef,
}: ComposerProps) {
  const canSubmit = !busy && !disabled && !!value.trim();
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [value, inputRef]);

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
        aria-label="Ask a question"
      >
        <div className="composer-row">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSubmit) onSubmit();
              }
            }}
            placeholder="Ask anything. Beamling will show you where the answer comes from."
            rows={1}
            aria-label="Your question"
            enterKeyHint="send"
          />
          {busy ? (
            <button
              type="button"
              className="send stop"
              onClick={onStop}
              disabled={stopping}
              aria-label={stopping ? "Stopping" : "Stop generating"}
            >
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!canSubmit} aria-label="Send question">
              <Icon name="arrow-up" size={17} />
            </button>
          )}
        </div>
        <div className="composer-tools">
          <div className="segmented" role="group" aria-label="Answer mode">
            {MODES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => onModeChange(value)}
                title={value === "deeper" ? "Agentic research loop with up to 60 searches" : undefined}
              >
                <Icon name={MODE_ICONS[value]} size={12} /> {MODE_LABELS[value]}
              </button>
            ))}
          </div>
          <span className="badge badge-mono composer-model" title="Model used for the next answer">
            {modelLabel}
          </span>
          <label className="composer-provider-wrap" title="Search provider used for the next answer">
            <span className="sr-only">Search provider</span>
            <select
              className="composer-provider"
              value={searchProvider}
              onChange={(event) => {
                const next = SEARCH_PROVIDERS.find((provider) => provider.id === event.target.value);
                if (next) onSearchProviderChange(next.id);
              }}
            >
              {SEARCH_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {keyedProviders.has(provider.id) ? provider.name : `${provider.name} · no key`}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <span className="badge" title="Keys are stored encrypted on the server">
            Live
          </span>
        </div>
      </form>
      <div className="composer-hint">
        Beamling uses your keys. Answers can be wrong — check the sources.
      </div>
    </div>
  );
}
