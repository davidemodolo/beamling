"use client";

import { memo, useCallback } from "react";
import { describeAnswerError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { llmModelName, SEARCH_PROVIDER_LABEL } from "@/lib/providers";
import type { Message, Source } from "@/lib/types";
import { formatCost, formatNumber } from "@/lib/utils";
import { useSidebar } from "./chat-shell";
import { Markdown } from "./markdown";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";

interface AnswerCardProps {
  message: Message;
  // Callbacks take the message id so the parent can pass stable functions and memo can skip re-renders.
  onCitation: (messageId: string, source: Source) => void;
  onOpenSources: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
}

export const AnswerCard = memo(function AnswerCard({ message, onCitation, onOpenSources, onRetry }: AnswerCardProps) {
  const { openSettings } = useSidebar();
  const [toast, showToast] = useToast();

  const sources = message.sources;
  const providerName = message.llmModel ? llmModelName(message.llmModel) : "";
  const searchName = SEARCH_PROVIDER_LABEL;
  const retry = onRetry ? () => onRetry(message.id) : undefined;

  const copy = async () => {
    const copied = await copyText(message.content);
    showToast(copied ? "Answer copied" : "Could not copy");
  };

  const cite = useCallback(
    (position: number) => {
      const source = sources?.find((s) => s.position === position);
      if (source) onCitation(message.id, source);
    },
    [sources, onCitation, message.id],
  );

  const error = message.status === "error" ? describeAnswerError(message.errorCode, message.errorMessage) : null;

  return (
    <article className="message message-assistant" aria-label="Beamling answer">
      <div className="assistant-head">
        <span className="mark" aria-hidden="true">
          <Mascot state={message.status === "error" ? "error" : message.status === "stopped" ? "stopped" : "done"} beams={false} label="" style={{ width: 22 }} />
        </span>
        <span>Beamling</span>
        <span className="dash" aria-hidden="true" />
        {message.status === "stopped" ? <span className="badge">Stopped</span> : null}
        {message.noSources ? <span className="badge badge-error">No sources</span> : null}
        {message.uncited && !message.noSources ? <span className="badge badge-error">Uncited</span> : null}
      </div>

      <div className="assistant-body">
        {message.noSources ? (
          <div className="notice notice-warn" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={16} />
            <div>
              <strong>Insufficient sources</strong>
              The search returned nothing reliable, so this answer is deliberately cautious.
            </div>
          </div>
        ) : null}

        {message.status === "stopped" ? (
          <div className="notice" style={{ marginBottom: 14 }}>
            <Icon name="stop" size={15} />
            <div>
              <strong>Generation stopped</strong>
              {message.content ? "The partial answer was kept." : "No text had been written yet."}
              {retry ? (
                <div style={{ marginTop: 10 }}>
                  {/* This starts a fresh answer to the same question; it does not continue the partial one. */}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
                    <Icon name="refresh" size={13} /> Ask again
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="notice notice-error">
            <Icon name="alert" size={16} />
            <div>
              <strong>{error.title}</strong>
              {error.message}
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {error.action === "settings" ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openSettings("keys")}>
                    <Icon name="key" size={13} /> Open settings
                  </button>
                ) : null}
                {error.action === "reload" ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
                    <Icon name="refresh" size={13} /> Reload
                  </button>
                ) : null}
                {retry && error.action !== "reload" ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
                    <Icon name="refresh" size={13} /> Retry
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <Markdown text={message.content} citations={sources?.length ?? 0} onCitation={cite} />
        )}

        {!error ? (
          <div className="answer-footer">
            <div className="meta">
              {providerName ? <span className="badge badge-mono">{providerName}</span> : null}
              {searchName ? <span className="badge badge-mono">{searchName}</span> : null}
              {message.usage ? (
                <>
                  <span className="dot" />
                  <span>{formatNumber(message.usage.tokensIn)} in</span>
                  <span>/</span>
                  <span>{formatNumber(message.usage.tokensOut)} out</span>
                  <span className="dot" />
                  <span>{formatCost(message.usage.costUsd)}</span>
                  {message.usage.latencyMs ? (
                    <>
                      <span className="dot" />
                      <span>{(message.usage.latencyMs / 1000).toFixed(1)} s</span>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="actions">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={copy} aria-label="Copy answer">
                <Icon name="copy" size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => onOpenSources(message.id)}
                aria-label={`Show ${sources?.length ?? 0} sources`}
              >
                <Icon name="panel-right" size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {toast}
    </article>
  );
});
