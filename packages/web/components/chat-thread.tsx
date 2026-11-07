"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { BeamlingHandle } from "@beamling/mascot/react";
import { STAGE_LABEL, type LiveAnswer } from "@/lib/answer-streams";
import type { ThreadMessage } from "@/lib/store";
import type { ChatStage, Source } from "@/lib/types";
import { AnswerCard, ReasoningDetails, SearchTraceDetails } from "./answer-card";
import { Markdown } from "./markdown";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";

export function UserBubble({ content }: { content: string }) {
  return (
    <div className="message message-user">
      <div className="bubble">{content}</div>
    </div>
  );
}

export function Thread({
  messages,
  retryId,
  onCitation,
  onOpenSources,
  onRetry,
}: {
  messages: ThreadMessage[];
  /** The one answer that can be retried: the latest, when it failed or was stopped. */
  retryId?: string;
  onCitation: (messageId: string, source: Source) => void;
  onOpenSources: (messageId: string) => void;
  onRetry: (messageId: string) => void;
}) {
  return messages.map((message) =>
    message.role === "user" ? (
      <UserBubble key={message.id} content={message.content} />
    ) : (
      <AnswerCard
        key={message.id}
        message={message}
        onCitation={onCitation}
        onOpenSources={onOpenSources}
        onRetry={message.id === retryId ? onRetry : undefined}
      />
    ),
  );
}

export function WorkingAnswer({
  live,
  providerName,
  modelName,
  onStop,
  onCitation,
}: {
  live: LiveAnswer;
  providerName: string;
  modelName: string;
  onStop: () => void;
  onCitation: (position: number) => void;
}) {
  const mascotRef = useRef<BeamlingHandle>(null);
  const hasSources = live.sources.length > 0;

  useEffect(() => {
    if (hasSources) mascotRef.current?.pulse(0.25);
  }, [hasSources]);

  useEffect(() => {
    if (live.citations) mascotRef.current?.pulse();
  }, [live.citations]);

  return (
    <article className="message message-assistant">
      <div className="working">
        <div className="working-mascot" aria-hidden="true">
          <Mascot
            ref={mascotRef}
            state={live.stage}
            beams={live.stage === "searching" || live.stage === "reading" || live.stage === "queued"}
            label=""
            style={{ width: 64 }}
          />
        </div>
        <div className="working-text">
          <strong>
            {live.stopping ? "Stopping" : STAGE_LABEL[live.stage]}
            <span className="dots" aria-hidden="true" style={{ marginLeft: 8 }}>
              <i />
              <i />
              <i />
            </span>
          </strong>
          <span>{workingDetail(live.stage, live.detail, providerName, modelName, live.sources.length)}</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onStop} disabled={live.stopping}>
          <Icon name="stop" size={11} /> {live.stopping ? "Stopping…" : "Stop"}
        </button>
      </div>
      <div className="assistant-body">
        <SearchTraceDetails traces={live.searches} />
        <ReasoningDetails reasoning={live.reasoning} streaming links={live.sources.map((source) => source.url)} />
      </div>
      {live.content ? (
        <div className="assistant-body">
          <Markdown text={live.content} citations={live.sources.length} onCitation={onCitation} streaming allowedLinks={live.sources.map((source) => source.url)} />
        </div>
      ) : (
        <div className="skeleton-answer" aria-hidden="true">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      )}
    </article>
  );
}

function workingDetail(stage: ChatStage, detail: string, provider: string, model: string, sourceCount: number): string {
  if (stage === "searching") return `${provider}${detail ? ` · ${detail}` : ""}`;
  if (stage === "reading") return detail || `${sourceCount} sources`;
  if (stage === "writing") return `${model} · ${sourceCount} sources`;
  return detail || "This usually takes a few seconds";
}

export function NotFoundState() {
  return (
    <div style={{ paddingTop: 60, textAlign: "center" }}>
      <div className="sources-empty" style={{ padding: 0 }}>
        <div className="mark" style={{ width: 90 }}>
          <Mascot expression="confused" beams={false} label="" style={{ width: 90 }} />
        </div>
        <h1 style={{ color: "var(--text)", fontSize: 22, marginBottom: 6 }}>Conversation not found</h1>
        <p style={{ marginBottom: 18 }}>It may have been deleted, or it belongs to another account.</p>
        <Link href="/chat" className="btn btn-secondary btn-sm">
          <Icon name="plus" size={14} /> New question
        </Link>
      </div>
    </div>
  );
}

export function LoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ paddingTop: 60 }}>
      <div className="notice notice-error" role="alert">
        <Icon name="alert" size={16} />
        <div>
          <strong>Could not load this conversation</strong>
          {message}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
              <Icon name="refresh" size={13} /> Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The new-question screen. `onFinishSetup` is set when a model or search key is missing. */
export function EmptyState({ onFinishSetup }: { onFinishSetup?: () => void }) {
  return (
    <div className="thread-empty">
      <div className="empty-hero">
        <div className="empty-mascot">
          <Mascot state="empty" beams={false} followPointer label="Beamling" style={{ width: "100%" }} />
        </div>
        <h1>
          Ask anything. <em>See the sources.</em>
        </h1>
        <p>Every answer shows its sources.</p>
        {onFinishSetup ? (
          <div className="notice notice-warn" role="status">
            <Icon name="key" size={16} />
            <div>
              <strong>A key is missing.</strong>{" "}
              <button type="button" className="btn btn-secondary btn-sm" onClick={onFinishSetup}>
                Add a key
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadSkeleton() {
  return (
    <div className="skeleton-answer" style={{ marginTop: 40 }}>
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
    </div>
  );
}
