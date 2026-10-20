"use client";

import { useEffect, type RefObject } from "react";
import { Icon } from "./ui/icon";
import type { Mode } from "@/lib/types";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  modelLabel: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({ value, onChange, onSubmit, onStop, busy, mode, onModeChange, modelLabel, inputRef }: ComposerProps) {
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
          if (!busy && value.trim()) onSubmit();
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
                if (!busy && value.trim()) onSubmit();
              }
            }}
            placeholder="Ask anything. Beamling will show you where the answer comes from."
            rows={1}
            aria-label="Your question"
            enterKeyHint="send"
          />
          {busy ? (
            <button type="button" className="send stop" onClick={onStop} aria-label="Stop generating">
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!value.trim()} aria-label="Send question">
              <Icon name="arrow-up" size={17} />
            </button>
          )}
        </div>
        <div className="composer-tools">
          <div className="segmented" role="group" aria-label="Answer mode">
            <button type="button" aria-pressed={mode === "quick"} onClick={() => onModeChange("quick")}>
              <Icon name="zap" size={12} /> Quick
            </button>
            <button type="button" aria-pressed={mode === "deep"} onClick={() => onModeChange("deep")}>
              <Icon name="layers" size={12} /> Deep
            </button>
          </div>
          <span className="badge badge-mono" title="Model used for the next answer">
            {modelLabel}
          </span>
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
