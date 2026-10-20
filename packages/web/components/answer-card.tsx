"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import { llmModelName, SEARCH_PROVIDER_LABEL } from "@/lib/providers";
import type { Message, Source } from "@/lib/types";
import { formatCost, formatNumber } from "@/lib/utils";
import { Markdown } from "./markdown";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";
import { Toast } from "./ui/toast";

interface AnswerCardProps {
  message: Message;
  onCitation: (source: Source) => void;
  onOpenSources: () => void;
  onRetry?: () => void;
}

export function AnswerCard({ message, onCitation, onOpenSources, onRetry }: AnswerCardProps) {
  const [toast, setToast] = useState<string | null>(null);

  const sources = message.sources ?? [];
  const providerName = message.llmModel ? llmModelName(message.llmModel) : "";
  const searchName = SEARCH_PROVIDER_LABEL;

  const copy = async () => {
    const copied = await copyText(message.content);
    setToast(copied ? "Answer copied" : "Could not copy");
  };

  const cite = (position: number) => {
    const source = sources.find((s) => s.position === position);
    if (source) onCitation(source);
  };

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
              {onRetry ? (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                    <Icon name="refresh" size={13} /> Resume
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {message.status === "error" ? (
          <div className="notice notice-error">
            <Icon name="alert" size={16} />
            <div>
              <strong>{message.errorCode ?? "PROVIDER_ERROR"}</strong>
              {message.errorMessage ?? "The provider could not complete this request."}
              {onRetry ? (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                    <Icon name="refresh" size={13} /> Retry
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <Markdown text={message.content} citations={sources.length} onCitation={cite} />
        )}

        {message.status !== "error" ? (
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
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onOpenSources} aria-label={`Show ${sources.length} sources`}>
                <Icon name="panel-right" size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </article>
  );
}
