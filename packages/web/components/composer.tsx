"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ComposerImages } from "./composer-images";
import { Icon } from "./ui/icon";
import { ATTACH_ACCEPT } from "@/lib/attachments";
import type { PreparedFile, PreparedImage } from "@/lib/images";
import { MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";
import { SEARCH_PROVIDERS } from "@/lib/provider-catalog";
import type { Mode, SearchProvider } from "@/lib/types";

/** Images and text files for the next question. */
export interface ComposerAttach {
  images: PreparedImage[];
  files: PreparedFile[];
  adding: boolean;
  add: (files: File[]) => void;
  remove: (id: string) => void;
  /** The selected model reads images; when it does not, sending images is blocked. Text files always work. */
  modelReadsImages: boolean;
  onChangeModel: () => void;
}

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
  attach: ComposerAttach;
}

const files = (list: FileList | null | undefined): File[] => Array.from(list ?? []);

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
  attach,
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasImages = attach.images.length > 0;
  const blockedByModel = hasImages && !attach.modelReadsImages;
  const hasAttachments = hasImages || attach.files.length > 0;
  const canSubmit = !busy && !disabled && !attach.adding && !blockedByModel && (!!value.trim() || hasAttachments);
  const canAttach = !disabled;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [value, inputRef]);

  return (
    <div className="composer-wrap">
      <form
        className={`composer${dragging ? " dragging" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
        onDragOver={(event) => {
          if (!canAttach || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          if (!canAttach) return;
          event.preventDefault();
          attach.add(files(event.dataTransfer.files));
        }}
        aria-label="Ask a question"
      >
        <ComposerImages images={attach.images} files={attach.files} adding={attach.adding} onRemove={attach.remove} />
        {blockedByModel ? (
          <p className="composer-warning" role="alert">
            <Icon name="alert" size={12} /> {modelLabel} cannot read images.{" "}
            <button type="button" className="composer-warning-action" onClick={attach.onChangeModel}>
              Change model
            </button>
          </p>
        ) : null}
        <div className="composer-row">
          <button
            type="button"
            className="attach"
            onClick={() => fileRef.current?.click()}
            disabled={!canAttach}
            aria-label="Attach images or text files"
            title={attach.modelReadsImages ? "Attach images or .md and .txt files" : `Attach .md or .txt files (${modelLabel} cannot read images)`}
          >
            <Icon name="image" size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              attach.add(files(event.target.files));
              event.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onPaste={(event) => {
              const pasted = files(event.clipboardData.files);
              if (!pasted.length || !canAttach) return;
              event.preventDefault();
              attach.add(pasted);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSubmit) onSubmit();
              }
            }}
            placeholder="Ask anything"
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
        </div>
      </form>
      <div className="composer-hint">
        Answers are AI-generated with your keys and can be wrong. Check the sources.
      </div>
    </div>
  );
}
