"use client";

import { memo, useCallback, type ReactNode } from "react";
import { describeAnswerError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { llmModelName, searchProviderName } from "@/lib/providers";
import type { ThreadMessage } from "@/lib/store";
import type { SearchProvider, SearchTrace, Source, Usage } from "@/lib/types";
import { formatCost, formatNumber } from "@/lib/utils";
import { useSidebar } from "./chat-shell";
import { Markdown } from "./markdown";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";

interface AnswerCardProps {
  message: ThreadMessage;
  // Callbacks take the message id so the parent can pass stable functions and memo can skip re-renders.
  onCitation: (messageId: string, source: Source) => void;
  onOpenSources: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
}

/** Selected model, plus what OpenRouter actually routed it to when that differs. */
function ModelBadges({ selected, searchProvider, usage }: { selected?: string; searchProvider?: SearchProvider; usage?: Usage }) {
  const resolved = usage?.resolvedModel;
  const rerouted = resolved && selected && resolved !== selected;
  return (
    <>
      {selected ? (
        <span className="badge badge-mono" title={`Selected model: ${selected}`}>
          {llmModelName(selected)}
        </span>
      ) : null}
      {rerouted ? (
        <span className="badge badge-mono" title="The model OpenRouter used for this answer">
          → {resolved}
        </span>
      ) : null}
      {usage?.upstreamProvider ? (
        <span className="badge badge-mono" title="Upstream provider chosen by OpenRouter">
          via {usage.upstreamProvider}
        </span>
      ) : null}
      {searchProvider ? <span className="badge badge-mono">{searchProviderName(searchProvider)}</span> : null}
    </>
  );
}

function UsageLine({ usage }: { usage: Usage }) {
  const searches = usage.searchRequests ?? 0;
  return (
    <>
      <span className="dot" />
      <span>{formatNumber(usage.tokensIn)} in</span>
      <span>/</span>
      <span>{formatNumber(usage.tokensOut)} out</span>
      <span className="dot" />
      <span title="Generation cost reported by OpenRouter">{formatCost(usage.costUsd)} actual</span>
      {usage.searchCostUsd != null ? (
        <span title={`${searchProviderName(usage.searchProvider ?? "brave")} cost at the list price`}>
          + {formatCost(usage.searchCostUsd)} est. ({searches} {searches === 1 ? "search" : "searches"})
        </span>
      ) : null}
      {usage.latencyMs ? (
        <>
          <span className="dot" />
          <span>{(usage.latencyMs / 1000).toFixed(1)} s</span>
        </>
      ) : null}
    </>
  );
}

function Notice({ icon, title, children, tone }: { icon: "alert" | "stop"; title: string; children: ReactNode; tone?: "warn" }) {
  return (
    <div className={`notice${tone === "warn" ? " notice-warn" : ""}`} style={{ marginBottom: 14 }}>
      <Icon name={icon} size={icon === "stop" ? 15 : 16} />
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}


export function SearchTraceDetails({ traces }: { traces?: SearchTrace[] }) {
  if (!traces?.length) return null;
  const done = traces.filter((trace) => trace.status === "done").length;
  return (
    <details className="trace">
      <summary>
        <span>Searches</span>
        <span className="trace-count">
          {done}/{traces.length}
        </span>
      </summary>
      <ol className="trace-list">
        {traces.map((trace, index) => (
          <li key={`${trace.query}-${index}`} data-status={trace.status}>
            <span className="trace-query">{trace.query}</span>
            <span className="trace-status">
              {trace.status === "searching"
                ? "searching…"
                : trace.status === "failed"
                  ? "failed"
                  : `${trace.results ?? 0} ${trace.results === 1 ? "result" : "results"}`}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ReasoningDetails({ reasoning, streaming }: { reasoning?: string; streaming?: boolean }) {
  if (!reasoning) return null;
  return (
    <details className="trace trace-reasoning">
      <summary>
        <span>Model reasoning</span>
        <span className="trace-count">{streaming ? "live" : "provided by the model"}</span>
      </summary>
      <div className="reasoning-body">
        <Markdown text={reasoning} citations={0} streaming={streaming} />
      </div>
    </details>
  );
}

export const AnswerCard = memo(function AnswerCard({ message, onCitation, onOpenSources, onRetry }: AnswerCardProps) {
  const { openSettings } = useSidebar();
  const [toast, showToast] = useToast();

  const sources = message.sources;
  const retry = onRetry ? () => onRetry(message.id) : undefined;
  const writing = message.status === "streaming" || message.status === "pending";
  const timedOut = message.status === "stopped" && message.errorCode === "GENERATION_TIMEOUT";

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
  const failedSearches = message.searchFailures ?? 0;

  return (
    <article className="message message-assistant" aria-label="Beamling answer" aria-busy={writing || undefined}>
      <div className="assistant-head">
        <span className="mark" aria-hidden="true">
          <Mascot
            state={writing ? "writing" : message.status === "error" ? "error" : message.status === "stopped" ? "stopped" : "done"}
            beams={false}
            label=""
            style={{ width: 22 }}
          />
        </span>
        <span>Beamling</span>
        <span className="dash" aria-hidden="true" />
        {message.status === "stopped" ? <span className="badge">Stopped</span> : null}
        {message.noSources ? <span className="badge badge-error">No sources</span> : null}
        {message.uncited && !message.noSources ? <span className="badge badge-error">Uncited</span> : null}
      </div>

      <div className="assistant-body">
        {writing ? (
          <div className="notice" style={{ marginBottom: 14 }} role="status">
            <Icon name="loader" size={15} className="spin" />
            <div>
              <strong>Still writing</strong>
              This answer is being written in another tab or was started before a reload. It updates when it finishes.
            </div>
          </div>
        ) : null}

        {message.noSources ? (
          <Notice icon="alert" title="Insufficient sources" tone="warn">
            The search returned nothing reliable, so this answer is deliberately cautious.
          </Notice>
        ) : null}

        {message.degraded ? (
          <Notice icon="alert" title="Simplified research" tone="warn">
            The research plan could not be built, so Beamling searched your question directly instead of 3–5 sub-queries.
          </Notice>
        ) : null}

        {failedSearches > 0 && message.status !== "error" ? (
          <Notice icon="alert" title="Some searches failed" tone="warn">
            {failedSearches === 1 ? "One search" : `${failedSearches} searches`} failed, so this answer uses only the
            sources that were found.
          </Notice>
        ) : null}

        <SearchTraceDetails traces={message.searches} />
        <ReasoningDetails reasoning={message.reasoning} />

        {message.truncated ? (
          <Notice icon="alert" title="Cut short" tone="warn">
            The answer reached the model&apos;s length limit before it finished.
          </Notice>
        ) : null}

        {message.status === "stopped" ? (
          <div className="notice" style={{ marginBottom: 14 }}>
            <Icon name="stop" size={15} />
            <div>
              <strong>{timedOut ? "Time limit reached" : "Generation stopped"}</strong>
              {timedOut ? `${message.errorMessage ?? "The answer took too long."} ` : null}
              {message.content ? "The partial answer was kept." : "No text had been written yet."}
              {retry ? (
                <div style={{ marginTop: 10 }}>
                  {/* This replaces the stopped answer with a fresh one; it does not continue the partial one. */}
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

        {!error && !writing ? (
          <div className="answer-footer">
            <div className="meta">
              <ModelBadges selected={message.llmModel} searchProvider={message.searchProvider ?? message.usage?.searchProvider} usage={message.usage} />
              {message.usage ? <UsageLine usage={message.usage} /> : null}
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
