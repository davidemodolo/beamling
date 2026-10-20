"use client";

import Link from "next/link";
import type { RefObject } from "react";
import type { BeamlingHandle } from "@beamling/mascot/react";
import { STAGE_LABEL, type LiveAnswer } from "@/lib/hooks/use-answer-stream";
import type { ChatStage, Message, Source } from "@/lib/types";
import { AnswerCard } from "./answer-card";
import { Markdown } from "./markdown";
import { Mascot } from "./mascot";
import { Icon } from "./ui/icon";

export function Thread({
  messages,
  onCitation,
  onOpenSources,
  onRetry,
}: {
  messages: Message[];
  onCitation: (messageId: string, source: Source) => void;
  onOpenSources: (messageId: string) => void;
  onRetry: (messageId: string) => void;
}) {
  return messages.map((message) =>
    message.role === "user" ? (
      <div className="message message-user" key={message.id}>
        <div className="bubble">{message.content}</div>
      </div>
    ) : (
      <AnswerCard
        key={message.id}
        message={message}
        onCitation={onCitation}
        onOpenSources={onOpenSources}
        onRetry={onRetry}
      />
    ),
  );
}

export function WorkingAnswer({
  live,
  stage,
  detail,
  providerName,
  modelName,
  mascotRef,
  onStop,
  onCitation,
}: {
  live: LiveAnswer;
  stage: ChatStage;
  detail: string;
  providerName: string;
  modelName: string;
  mascotRef: RefObject<BeamlingHandle | null>;
  onStop: () => void;
  onCitation: (position: number) => void;
}) {
  return (
    <article className="message message-assistant">
      <div className="working">
        <div className="working-mascot" aria-hidden="true">
          <Mascot
            ref={mascotRef}
            state={stage}
            beams={stage === "searching" || stage === "reading" || stage === "queued"}
            label=""
            style={{ width: 64 }}
          />
        </div>
        <div className="working-text">
          <strong>
            {STAGE_LABEL[stage]}
            <span className="dots" aria-hidden="true" style={{ marginLeft: 8 }}>
              <i />
              <i />
              <i />
            </span>
          </strong>
          <span>{workingDetail(stage, detail, providerName, modelName, live.sources.length)}</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onStop}>
          <Icon name="stop" size={11} /> Stop
        </button>
      </div>
      {live.content ? (
        <div className="assistant-body">
          <Markdown text={live.content} citations={live.sources.length} onCitation={onCitation} streaming />
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
        <p style={{ marginBottom: 18 }}>It may have been deleted, or it belongs to another guest session.</p>
        <Link href="/chat" className="btn btn-secondary btn-sm">
          <Icon name="plus" size={14} /> New question
        </Link>
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="thread-empty">
      <div className="empty-hero">
        <div className="empty-mascot">
          <Mascot state="empty" beams={false} followPointer label="Beamling" style={{ width: "100%" }} />
        </div>
        <h1>
          Ask anything. <em>See the sources.</em>
        </h1>
        <p>Beamling searches with your keys, reads what it finds, and shows you where every answer comes from.</p>
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
