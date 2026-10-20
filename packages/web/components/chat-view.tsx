"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "./chat-shell";
import { EmptyState, NotFoundState, Thread, ThreadSkeleton, WorkingAnswer } from "./chat-thread";
import { Composer } from "./composer";
import { SourcesPanel, SourcesSheet } from "./sources";
import { Icon } from "./ui/icon";
import { useAnswerStream } from "@/lib/hooks/use-answer-stream";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useToast } from "@/lib/hooks/use-toast";
import { llmModelName, SEARCH_PROVIDER_LABEL } from "@/lib/providers";
import { useStore } from "@/lib/store";
import type { Message, Mode, Source } from "@/lib/types";
import { collapseWhitespace } from "@/lib/utils";

interface ChatViewProps {
  conversationId?: string;
}

export function ChatView({ conversationId }: ChatViewProps) {
  const pathname = usePathname();
  const [session, setSession] = useState(0);
  const [previousPath, setPreviousPath] = useState(pathname);
  if (pathname !== previousPath) {
    setPreviousPath(pathname);
    // A new chat rewrites the URL to /chat/{id} without remounting. Coming back to /chat
    // ("New question", or deleting the active conversation) must start from a clean view.
    if (!conversationId && pathname === "/chat") setSession((value) => value + 1);
  }
  return <ChatPane key={session} conversationId={conversationId} />;
}

function ChatPane({ conversationId }: ChatViewProps) {
  const { openSidebar, openSettings } = useSidebar();
  const { ready, error, user, conversations, settings, createConversation, setConversationMode } = useStore();
  const isMobile = useIsMobile();

  // Set once a new chat has created its conversation (the URL is rewritten in place).
  const [localId, setLocalId] = useState<string | null>(null);
  const activeId = conversationId ?? localId;
  // No stale fallback: if the conversation is gone from the store (deleted), the view starts over.
  const conversation = activeId ? conversations.find((c) => c.id === activeId) : undefined;
  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);

  const [input, setInput] = useState("");
  // Mode picked before the first question; kept local so it does not change the saved default.
  const [draftMode, setDraftMode] = useState<Mode | null>(null);
  const mode = conversation?.mode ?? draftMode ?? settings.defaultMode;
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [sourcesHidden, setSourcesHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, showToast] = useToast();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const { live, stage, detail, announce, mascotRef, start, stop } = useAnswerStream({
    onStart: () => {
      setInput("");
      setActiveSource(null);
      setSheetOpen(false);
      setSourcesHidden(false);
      stickRef.current = true;
    },
    onMessageId: setSourceMessageId,
    onStartError: showToast,
    onSettled: () => {
      if (!isMobile) {
        window.setTimeout(() => inputRef.current?.focus(), 60);
      }
    },
  });

  const startAnswer = useCallback(
    (question: string, appendUser = true) => {
      const clean = collapseWhitespace(question);
      if (!clean) return;
      void start({
        question: clean,
        mode,
        appendUser,
        resolveConversation: async () => {
          if (conversation) return conversation.id;
          const created = await createConversation(mode);
          setLocalId(created.id);
          window.history.replaceState(null, "", `/chat/${created.id}`);
          return created.id;
        },
      });
    },
    [start, mode, conversation, createConversation],
  );

  useEffect(() => {
    if (!stickRef.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live?.content, stage, messages.length]);

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return undefined;
  }, [messages]);

  const contextMessage = (sourceMessageId && messages.find((message) => message.id === sourceMessageId)) || lastAssistant;
  const sources = live ? live.sources : contextMessage?.sources ?? [];
  const providerName = SEARCH_PROVIDER_LABEL;
  const modelName = llmModelName(settings.llmModel);
  const loadingSources = !!live && !live.sources.length && (stage === "searching" || stage === "reading");
  const showSources = !sourcesHidden && (sources.length > 0 || loadingSources);

  const openSource = useCallback(
    (source: Source) => {
      setActiveSource(source.position);
      const scrollToSource = () => {
        document.getElementById(`source-${source.position}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      if (isMobile) {
        setSheetOpen(true);
        window.setTimeout(scrollToSource, 160);
        return;
      }
      setSourcesHidden(false);
      window.setTimeout(scrollToSource, 90);
    },
    [isMobile],
  );

  const onCitation = useCallback(
    (messageId: string, source: Source) => {
      setSourceMessageId(messageId);
      openSource(source);
    },
    [openSource],
  );

  const onOpenSources = useCallback(
    (messageId: string) => {
      setSourceMessageId(messageId);
      if (isMobile) setSheetOpen(true);
      else setSourcesHidden(false);
    },
    [isMobile],
  );

  const onRetry = useCallback(
    (messageId: string) => startAnswer(questionFor(messages, messageId), false),
    [startAnswer, messages],
  );

  const onLiveCitation = (position: number) => {
    const source = live?.sources.find((s) => s.position === position);
    if (source) openSource(source);
  };

  const toggleSources = () => {
    if (isMobile) {
      setSheetOpen(true);
      return;
    }
    if (!sources.length && !loadingSources) {
      showToast("This answer has no sources");
      return;
    }
    setSourcesHidden((hidden) => !hidden);
  };

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };

  // A failed initial load is shown by the shell; don't claim the conversation is missing.
  const loadFailed = !!error && !user;
  const notFound = !!conversationId && ready && !loadFailed && !conversation;

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
              aria-expanded={isMobile ? sheetOpen : showSources}
              aria-controls={isMobile ? (sheetOpen ? "sources-sheet" : undefined) : showSources ? "sources-pane" : undefined}
              title="Sources"
            >
              <Icon name={sourcesHidden ? "panel-right" : "layers"} size={15} />
              <span className="mono" style={{ fontSize: 11 }}>
                {sources.length}
              </span>
            </button>
          ) : null}
          <button type="button" className="avatar" onClick={() => openSettings()} aria-label="Open settings">
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
              <ThreadSkeleton />
            ) : notFound ? (
              <NotFoundState />
            ) : messages.length === 0 && !live ? (
              <EmptyState />
            ) : (
              <>
                <Thread messages={messages} onCitation={onCitation} onOpenSources={onOpenSources} onRetry={onRetry} />
                {live ? (
                  <WorkingAnswer
                    live={live}
                    stage={stage}
                    detail={detail}
                    providerName={providerName}
                    modelName={modelName}
                    mascotRef={mascotRef}
                    onStop={stop}
                    onCitation={onLiveCitation}
                  />
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
        onStop={stop}
        busy={!!live}
        mode={mode}
        onModeChange={(next) => {
          if (conversation) setConversationMode(conversation.id, next);
          else setDraftMode(next);
        }}
        modelLabel={modelName}
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

      {toast}
    </main>
  );
}

function questionFor(messages: Message[], assistantId: string): string {
  const index = messages.findIndex((message) => message.id === assistantId);
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}
