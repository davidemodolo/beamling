"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BeamlingHandle } from "@beamling/mascot/react";
import { AnswerCard } from "./answer-card";
import { useSidebar } from "./chat-shell";
import { Composer } from "./composer";
import { Mascot } from "./mascot";
import { Markdown } from "./markdown";
import { SourcesPanel, SourcesSheet } from "./sources";
import { Icon } from "./ui/icon";
import { Toast } from "./ui/toast";
import { llmModelName, SEARCH_PROVIDER_LABEL } from "@/lib/providers";
import { streamAnswer, type StreamHandle } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { ChatStage, Conversation, Message, Mode, Source, Usage } from "@/lib/types";
import { createId } from "@/lib/utils";

interface LiveAnswer {
  id: string;
  content: string;
  sources: Source[];
  usage?: Usage;
  noSources: boolean;
}

interface ChatViewProps {
  conversationId?: string;
}

const STAGE_LABEL: Record<ChatStage, string> = {
  empty: "Ask a question",
  queued: "Thinking",
  searching: "Searching the web",
  reading: "Reading sources",
  writing: "Writing",
  done: "Answer complete",
  stopped: "Answer stopped",
  "no-sources": "No reliable sources",
  error: "The provider returned an error",
};

export function ChatView({ conversationId }: ChatViewProps) {
  const { openSidebar, openSettings } = useSidebar();
  const store = useStore();
  const { ready, conversations, settings, addMessage, createConversation, updateSettings, refreshConversation } = store;

  const storedConversation = conversationId ? conversations.find((c) => c.id === conversationId) : undefined;
  const [localConversation, setLocalConversation] = useState<Conversation | null>(null);
  const localStored = localConversation ? conversations.find((c) => c.id === localConversation.id) : undefined;
  const conversation = conversationId ? storedConversation : localStored ?? localConversation;
  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);

  const [input, setInput] = useState("");
  const [modeOverride, setModeOverride] = useState<{ conversationId: string | null; mode: Mode } | null>(null);
  const mode =
    modeOverride && modeOverride.conversationId === (conversation?.id ?? null)
      ? modeOverride.mode
      : conversation?.mode ?? settings.defaultMode;
  const setMode = useCallback(
    (next: Mode) => setModeOverride({ conversationId: conversation?.id ?? null, mode: next }),
    [conversation?.id],
  );
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const [stage, setStage] = useState<ChatStage>("empty");
  const [detail, setDetail] = useState("");
  const [announce, setAnnounce] = useState("");
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [sourcesHidden, setSourcesHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const liveRef = useRef<LiveAnswer | null>(null);
  const runRef = useRef<StreamHandle | null>(null);
  const serverMessageIdRef = useRef<string | null>(null);
  const finishingRef = useRef(false);
  const mascotRef = useRef<BeamlingHandle>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const updateLive = useCallback((updater: (previous: LiveAnswer) => LiveAnswer) => {
    setLive((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      liveRef.current = next;
      return next;
    });
  }, []);

  const startAnswer = useCallback(
    async (question: string, appendUser = true) => {
      const clean = question.replace(/\s+/g, " ").trim();
      if (!clean || liveRef.current) return;

      let target = conversation;
      if (!target) {
        try {
          target = await createConversation(mode);
        } catch (error) {
          setToast(error instanceof Error ? error.message : "Could not start a conversation.");
          setStage("error");
          return;
        }
        setLocalConversation(target);
        window.history.replaceState(null, "", `/chat/${target.id}`);
      }
      if (!target) return;

      if (appendUser) {
        addMessage(target.id, {
          id: createId("pending"),
          role: "user",
          content: clean,
          status: "complete",
          createdAt: new Date().toISOString(),
        });
      }

      setInput("");
      setActiveSource(null);
      setSheetOpen(false);
      setSourcesHidden(false);
      stickRef.current = true;
      serverMessageIdRef.current = null;
      finishingRef.current = false;

      const initialLive: LiveAnswer = {
        id: "pending-answer",
        content: "",
        sources: [],
        noSources: false,
      };
      liveRef.current = initialLive;
      setLive(initialLive);
      setStage("queued");
      setDetail("");
      setAnnounce(`Beamling is ${STAGE_LABEL.queued.toLowerCase()}.`);

      const finish = async (state: ChatStage, message: string, clearLive = true) => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        setStage(state);
        setAnnounce(message);
        runRef.current = null;
        if (clearLive) {
          if (state === "stopped") {
            await new Promise((resolve) => window.setTimeout(resolve, 450));
          }
          try {
            await refreshConversation(target.id);
          } catch {}
          setLive(null);
          liveRef.current = null;
        }
        if (window.matchMedia("(min-width: 901px)").matches) {
          window.setTimeout(() => inputRef.current?.focus(), 60);
        }
      };

      runRef.current = streamAnswer(
        { conversationId: target.id, question: clean, mode },
        {
          onMeta: (serverMeta) => {
            serverMessageIdRef.current = serverMeta.messageId;
            updateLive((current) => ({ ...current, id: serverMeta.messageId }));
            setSourceMessageId(serverMeta.messageId);
          },
          onStage: (nextStage, nextDetail) => {
            setStage(nextStage);
            setDetail(nextDetail ?? "");
            setAnnounce(`${STAGE_LABEL[nextStage]}${nextDetail ? `: ${nextDetail}` : ""}.`);
            if (nextStage === "stopped") {
              void finish("stopped", "Answer stopped. Partial text was kept.");
            }
          },
          onPlan: (queries) => {
            setDetail(`${queries.length} searches planned`);
          },
          onProgress: ({ completed, total }) => {
            setDetail(`${completed} of ${total} searches complete`);
          },
          onSources: (sources) => {
            updateLive((current) => ({ ...current, sources }));
            if (sources.length) mascotRef.current?.pulse(0.25);
          },
          onDelta: (text) => {
            updateLive((current) => ({ ...current, content: current.content + text }));
          },
          onCitation: () => {
            mascotRef.current?.pulse();
          },
          onUsage: (usage) => {
            updateLive((current) => ({ ...current, usage }));
          },
          onDone: (result) => {
            void finish(
              result.noSources ? "no-sources" : "done",
              result.noSources
                ? "Answer complete, but no reliable sources were found."
                : "Answer complete.",
            );
          },
          onError: (error) => {
            const messageId = serverMessageIdRef.current;
            if (!messageId) {
              addMessage(target.id, {
                id: createId("pending"),
                role: "assistant",
                content: "",
                status: "error",
                createdAt: new Date().toISOString(),
                mode,
                sources: [],
                llmModel: settings.llmModel,
                errorCode: error.code,
                errorMessage: error.message,
              });
              setStage("error");
              setAnnounce(`Error: ${error.message}`);
              setLive(null);
              liveRef.current = null;
              runRef.current = null;
              return;
            }
            void finish("error", `Error: ${error.message}`);
          },
          onStopped: () => {
            void finish("stopped", "Answer stopped. Partial text was kept.");
          },
        },
      );
    },
    [
      conversation,
      mode,
      createConversation,
      addMessage,
      settings,
      updateLive,
      refreshConversation,
    ],
  );

  useEffect(() => {
    return () => {
      runRef.current?.stop();
      runRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live?.content, stage, messages.length]);

  const retry = (question: string) => startAnswer(question, false);

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return undefined;
  }, [messages]);

  const contextMessage = sourceMessageId ? messages.find((message) => message.id === sourceMessageId) : lastAssistant;
  const sources = live ? live.sources : contextMessage?.sources ?? [];
  const providerName = SEARCH_PROVIDER_LABEL;
  const modelName = llmModelName(settings.llmModel);
  const loadingSources = !!live && !live.sources.length && (stage === "searching" || stage === "reading");
  const showSources = !sourcesHidden && (sources.length > 0 || loadingSources);

  const openSource = (source: Source) => {
    setActiveSource(source.position);
    const scrollToSource = () => {
      document.getElementById(`source-${source.position}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    if (window.matchMedia("(max-width: 900px)").matches) {
      setSheetOpen(true);
      window.setTimeout(scrollToSource, 160);
      return;
    }
    if (sourcesHidden) setSourcesHidden(false);
    window.setTimeout(scrollToSource, 90);
  };

  const toggleSources = () => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setSheetOpen(true);
      return;
    }
    if (!sources.length && !loadingSources) {
      setToast("This answer has no sources");
      return;
    }
    setSourcesHidden((hidden) => !hidden);
  };

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };

  const busy = !!live;
  const notFound = conversationId && ready && !storedConversation;

  return (
    <main className="main-pane" id="main">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon mobile-only" onClick={openSidebar} aria-label="Open conversations">
          <Icon name="menu" size={18} />
        </button>
        <div className="topbar-title">
          <strong>{conversation?.title ?? (conversationId ? "Loading…" : "New question")}</strong>
          <span>
            {mode === "deep" ? "Deep" : "Quick"} · {modelName} · {providerName}
          </span>
        </div>
        <div className="topbar-actions">
          {sources.length || loadingSources ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toggleSources}
              aria-label={`Sources, ${sources.length}`}
              title="Sources"
            >
              <Icon name={sourcesHidden ? "panel-right" : "layers"} size={15} />
              <span className="mono" style={{ fontSize: 11 }}>
                {sources.length}
              </span>
            </button>
          ) : null}
          <button type="button" className="avatar" onClick={openSettings} aria-label="Open settings">
            G
          </button>
        </div>
      </header>

      <div className={`chat-layout ${showSources ? "with-sources" : ""}`}>
        <div className="thread-scroll" ref={threadRef} onScroll={onThreadScroll}>
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
          <div className="thread">
            {!ready && conversationId ? (
              <div className="skeleton-answer" style={{ marginTop: 40 }}>
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
              </div>
            ) : notFound ? (
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
            ) : messages.length === 0 && !live ? (
              <EmptyState />
            ) : (
              <>
                {messages.map((message, index) => {
                  if (message.role === "user") {
                    return (
                      <div className="message message-user" key={message.id}>
                        <div className="bubble">{message.content}</div>
                      </div>
                    );
                  }
                  const question = questionFor(messages, index);
                  return (
                    <AnswerCard
                      key={message.id}
                      message={message}
                      onCitation={(source) => {
                        setSourceMessageId(message.id);
                        openSource(source);
                      }}
                      onOpenSources={() => {
                        setSourceMessageId(message.id);
                        if (window.matchMedia("(max-width: 900px)").matches) setSheetOpen(true);
                        else setSourcesHidden(false);
                      }}
                      onRetry={() => retry(question)}
                    />
                  );
                })}

                {live ? (
                  <article className="message message-assistant">
                    <div className="working">
                      <div className="working-mascot" aria-hidden="true">
                        <Mascot
                          ref={mascotRef}
                          state={stage === "queued" ? "queued" : stage}
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
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => runRef.current?.stop()}>
                        <Icon name="stop" size={11} /> Stop
                      </button>
                    </div>
                    {live.content ? (
                      <div className="assistant-body">
                        <Markdown
                          text={live.content}
                          citations={live.sources.length}
                          onCitation={(position) => {
                            const source = live.sources.find((s) => s.position === position);
                            if (source) openSource(source);
                          }}
                          streaming
                        />
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
                ) : null}
              </>
            )}
          </div>
        </div>

        {showSources ? (
          <SourcesPanel
            sources={sources}
            active={activeSource}
            loading={loadingSources}
            onSelect={setActiveSource}
            provider={providerName}
            onClose={() => setSourcesHidden(true)}
          />
        ) : null}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => startAnswer(input)}
        onStop={() => runRef.current?.stop()}
        busy={busy}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          if (conversation) store.setConversationMode(conversation.id, next);
          else updateSettings({ defaultMode: next });
        }}
        modelLabel={llmModelName(settings.llmModel)}
        inputRef={inputRef}
      />

      <SourcesSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sources={sources}
        active={activeSource}
        loading={loadingSources}
        onSelect={(position) => {
          setActiveSource(position);
          const source = sources.find((s) => s.position === position);
          if (source) openSource(source);
        }}
        provider={providerName}
      />

      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </main>
  );
}

function questionFor(messages: Message[], assistantIndex: number): string {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

function workingDetail(stage: ChatStage, detail: string, provider: string, model: string, sourceCount: number): string {
  if (stage === "searching") return `${provider}${detail ? ` · ${detail}` : ""}`;
  if (stage === "reading") return detail || `${sourceCount} sources`;
  if (stage === "writing") return `${model} · ${sourceCount} sources`;
  return detail || "This usually takes a few seconds";
}

function EmptyState() {
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
