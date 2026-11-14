"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BeamlingHandle } from "@beamling/mascot/react";
import { STAGE_LABEL, type LiveAnswer } from "@/lib/answer-streams";
import { MAX_QUESTION_CHARS } from "@/lib/legal";
import type { Attachment } from "@/lib/attachments";
import type { ThreadMessage } from "@/lib/store";
import type { ChatStage, Source } from "@/lib/types";
import { AnswerCard, ReasoningDetails, SearchTraceDetails } from "./answer-card";
import { Markdown } from "./markdown";
import { MessageImages } from "./message-images";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";

export function UserBubble({
  content,
  attachments,
  onEdit,
}: {
  content: string;
  attachments?: Attachment[];
  /** Set on the latest question: rewrites it and answers it again. */
  onEdit?: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null && !!onEdit;
  const canSend = editing && draft !== content && (!!draft.trim() || !!attachments?.length);
  const send = () => {
    if (!canSend) return;
    onEdit(draft);
    setDraft(null);
  };
  return (
    <div className="message message-user">
      {attachments?.length ? <MessageImages attachments={attachments} /> : null}
      {editing ? (
        <form
          className="bubble-edit"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            maxLength={MAX_QUESTION_CHARS}
            aria-label="Edit your question"
            autoFocus
          />
          <div className="bubble-edit-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={!canSend}>
              Send
            </button>
          </div>
        </form>
      ) : content || onEdit ? (
        <div className="bubble-row">
          {onEdit ? (
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm bubble-edit-button"
              onClick={() => setDraft(content)}
              aria-label="Edit question"
              title="Edit question"
            >
              <Icon name="pencil" size={13} />
            </button>
          ) : null}
          {content ? <div className="bubble">{content}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Thread({
  messages,
  retryId,
  editId,
  regenerateId,
  litId,
  onCitation,
  onOpenSources,
  onRetry,
  onEdit,
  onRegenerate,
}: {
  /** The answer that just finished here: the mascot lights its citations once. */
  litId?: string | null;
  messages: ThreadMessage[];
  /** The one answer that can be retried: the latest, when it failed or was stopped. */
  retryId?: string;
  /** The one question that can be edited: the latest. */
  editId?: string;
  /** The one answer that can be regenerated: the latest, when it is complete. */
  regenerateId?: string;
  onCitation: (messageId: string, source: Source) => void;
  onOpenSources: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  onEdit: (questionId: string, text: string) => void;
  onRegenerate: (messageId: string) => void;
}) {
  return messages.map((message) =>
    message.role === "user" ? (
      <UserBubble
        key={message.id}
        content={message.content}
        attachments={message.attachments}
        onEdit={message.id === editId ? (text) => onEdit(message.id, text) : undefined}
      />
    ) : (
      <AnswerCard
        key={message.id}
        message={message}
        onCitation={onCitation}
        onOpenSources={onOpenSources}
        onRetry={message.id === retryId ? onRetry : undefined}
        onRegenerate={message.id === regenerateId ? onRegenerate : undefined}
        lit={message.id === litId}
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
  // The search running now: the mascot turns its beam to it.
  const query = live.stage === "searching" ? live.searches.findLast((trace) => trace.status === "searching")?.query : undefined;

  useEffect(() => {
    if (hasSources) mascotRef.current?.pulse(0.25);
  }, [hasSources]);

  useEffect(() => {
    if (live.citations) mascotRef.current?.pulse();
  }, [live.citations]);

  useEffect(() => {
    if (query) mascotRef.current?.pulse(0.3);
  }, [query]);

  return (
    <article className="message message-assistant">
      <div className="working">
        <div className="working-mascot" aria-hidden="true">
          <Mascot ref={mascotRef} state={live.stage} activity={live.stage === "writing" ? "writing" : "idle"} beams={false} label="" style={{ width: 56 }} />
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
          {query ? (
            <span className="working-query" key={query} title={query}>
              {query}
            </span>
          ) : null}
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
        <Link href="/" className="btn btn-secondary btn-sm">
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
export function EmptyState({ onFinishSetup, attentive = false }: { onFinishSetup?: () => void; attentive?: boolean }) {
  const mascotRef = useRef<BeamlingHandle>(null);
  // While a question is being typed, the mascot looks down at the composer.
  useEffect(() => {
    if (attentive) mascotRef.current?.lookAt(0, 0.5, 4);
  }, [attentive]);
  return (
    <div className="thread-empty">
      <div className="empty-hero">
        <div className="empty-mascot">
          <Mascot ref={mascotRef} state="empty" expression={attentive ? "curious" : undefined} beams={false} followPointer label="Beamling" style={{ width: "100%" }} />
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
