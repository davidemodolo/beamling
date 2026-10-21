"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "./chat-shell";
import { EmptyState, LoadErrorState, NotFoundState, Thread, ThreadSkeleton, UserBubble, WorkingAnswer } from "./chat-thread";
import { Composer } from "./composer";
import { SourcesPanel, SourcesSheet } from "./sources";
import { Icon } from "./ui/icon";
import { useAnswerStreams, type LiveAnswer } from "@/lib/answer-streams";
import { api, errorMessage } from "@/lib/api";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useToast } from "@/lib/hooks/use-toast";
import { isSearchProvider, llmModelName, searchProviderName } from "@/lib/providers";
import { useStore, type ThreadMessage } from "@/lib/store";
import { MODE_LABELS } from "@/lib/modes";
import type { Mode, SearchProvider, Source } from "@/lib/types";
import { collapseWhitespace } from "@/lib/utils";

interface ChatViewProps {
  conversationId?: string;
}

/** How often a conversation is reloaded while an answer from elsewhere is still being written. */
const STREAMING_POLL_MS = 4000;

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
  // One pane per conversation, so a view never shows another conversation's state.
  return <ChatPane key={conversationId ?? `draft-${session}`} conversationId={conversationId} />;
}

/** Hides the stored rows of the exchange that is streaming; the live answer stands in for them. */
function visibleMessages(messages: ThreadMessage[], live: LiveAnswer | undefined): ThreadMessage[] {
  if (!live) return messages;
  const hidden = new Set([live.messageId, live.replaces, live.question ? live.userMessageId : null]);
  return messages.filter(
    (message) =>
      !hidden.has(message.id) &&
      !(message.role === "assistant" && (message.status === "streaming" || message.status === "pending")),
  );
}

/** The latest answer, when it can be retried. */
function retryableId(messages: ThreadMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || last.local === "provisional") return undefined;
  return last.status === "error" || last.status === "stopped" ? last.id : undefined;
}

function ChatPane({ conversationId }: ChatViewProps) {
  const { openSidebar, openSettings } = useSidebar();
  const {
    ready,
    error,
    user,
    conversations,
    threads,
    settings,
    loadThread,
    loadEarlierMessages,
    createConversation,
    setConversationMode,
    removeMessages,
  } = useStore();
  const streams = useAnswerStreams();
  const isMobile = useIsMobile();

  // Set once a new chat has created its conversation (the URL is rewritten in place).
  const [localId, setLocalId] = useState<string | null>(null);
  const activeId = conversationId ?? localId;
  const thread = activeId ? threads[activeId] : undefined;
  const summary = (activeId ? conversations.find((c) => c.id === activeId) : undefined) ?? thread?.conversation ?? undefined;
  const live = activeId ? streams.live[activeId] : undefined;
  const messages = useMemo(() => visibleMessages(thread?.messages ?? [], live), [thread, live]);

  const [input, setInput] = useState("");
  // Mode picked before the first question; kept local so it does not change the saved default.
  const [draftMode, setDraftMode] = useState<Mode | null>(null);
  const mode = summary?.mode ?? draftMode ?? settings.defaultMode;
  const [draftSearchProvider, setDraftSearchProvider] = useState<SearchProvider | null>(null);
  const searchProvider = draftSearchProvider ?? settings.defaultSearchProvider;
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [sourcesHidden, setSourcesHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, showToast] = useToast();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const creatingRef = useRef(false);
  const mountedRef = useRef(false);
  const wasLiveRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load the conversation once the workspace session exists; revisits refresh it in the background.
  const canLoad = ready && !!user;
  useEffect(() => {
    if (!conversationId || !canLoad) return;
    void loadThread(conversationId).catch(() => {});
  }, [conversationId, canLoad, loadThread]);

  // An answer started in another tab (or before a reload) is still being written: follow it.
  const storedStreaming = live
    ? undefined
    : thread?.messages.find(
        (message) => message.role === "assistant" && (message.status === "streaming" || message.status === "pending"),
      );
  const followStored = !!storedStreaming;
  useEffect(() => {
    if (!followStored || !activeId) return;
    const timer = window.setInterval(() => void loadThread(activeId).catch(() => {}), STREAMING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [followStored, activeId, loadThread]);

  useEffect(() => {
    if (wasLiveRef.current && !live && !isMobile) inputRef.current?.focus();
    wasLiveRef.current = !!live;
  }, [live, isMobile]);

  const beforeStart = useCallback(() => {
    setActiveSource(null);
    setSourceMessageId(null);
    setSheetOpen(false);
    setSourcesHidden(false);
    stickRef.current = true;
  }, []);

  const submit = useCallback(async () => {
    const question = collapseWhitespace(input);
    if (!question || live || followStored || creatingRef.current) return;
    let id = activeId;
    if (!id) {
      creatingRef.current = true;
      try {
        id = (await createConversation(mode)).id;
      } catch (cause) {
        showToast(errorMessage(cause, "Could not start a conversation."));
        return;
      } finally {
        creatingRef.current = false;
      }
      // The user left while the conversation was being created: do not start an answer they cannot see.
      if (!mountedRef.current) return;
      setLocalId(id);
      if (window.location.pathname === "/chat") window.history.replaceState(null, "", `/chat/${id}`);
    }
    if (streams.start({ conversationId: id, mode, searchProvider, question })) {
      setInput("");
      beforeStart();
    }
  }, [input, live, followStored, activeId, createConversation, mode, searchProvider, showToast, streams, beforeStart]);

  const onRetry = useCallback(
    (messageId: string) => {
      if (!activeId || live) return;
      const list = thread?.messages ?? [];
      const index = list.findIndex((message) => message.id === messageId);
      const failed = list[index];
      if (!failed) return;
      if (failed.local) {
        // Never stored: ask the same question again as a new one.
        const question = list.slice(0, index).findLast((message) => message.role === "user");
        if (!question) return;
        if (streams.start({ conversationId: activeId, mode, searchProvider, question: question.content })) {
          removeMessages(activeId, question.local ? [failed.id, question.id] : [failed.id]);
          beforeStart();
        }
        return;
      }
      const failedProvider = failed.searchProvider && isSearchProvider(failed.searchProvider) ? failed.searchProvider : searchProvider;
      setDraftSearchProvider(failedProvider);
      if (streams.start({ conversationId: activeId, mode: failed.mode ?? mode, searchProvider: failedProvider, retryOf: failed.id })) beforeStart();
    },
    [activeId, live, thread, streams, mode, searchProvider, removeMessages, beforeStart],
  );

  useEffect(() => {
    if (!stickRef.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live?.content, live?.stage, messages.length]);

  const lastAssistant = useMemo(() => messages.findLast((message) => message.role === "assistant"), [messages]);
  const contextMessage = (sourceMessageId && messages.find((message) => message.id === sourceMessageId)) || lastAssistant;
  const sources = live ? live.sources : contextMessage?.sources ?? [];
  const sourceProvider = live?.searchProvider ?? contextMessage?.searchProvider ?? searchProvider;
  const providerName = searchProviderName(sourceProvider);
  const selectedProviderName = searchProviderName(searchProvider);
  const modelName = llmModelName(settings.llmModel);
  const loadingSources = !!live && !live.sources.length && (live.stage === "searching" || live.stage === "reading");
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

  const showEarlier = () => {
    if (!activeId) return;
    stickRef.current = false;
    loadEarlierMessages(activeId).catch((cause) => showToast(errorMessage(cause, "Could not load earlier messages")));
  };

  // A failed initial load is shown by the shell; don't claim the conversation is missing.
  const loadFailed = !!error && !user;
  const loading = !!conversationId && (!ready || !thread || thread.status === "loading");
  const notFound = !!conversationId && !loadFailed && thread?.status === "missing";
  const threadError = !!conversationId && thread?.status === "error";
  const retryId = live ? undefined : retryableId(messages);

  return (
    <main className="main-pane" id="main">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon mobile-only" onClick={openSidebar} aria-label="Open conversations">
          <Icon name="menu" size={18} />
        </button>
        <div className="topbar-title">
          <strong>{summary?.title ?? (conversationId ? "Loading…" : "New question")}</strong>
          <span>
            {MODE_LABELS[mode]} · {modelName} · {selectedProviderName}
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
            {activeId ? streams.announcements[activeId] ?? "" : ""}
          </p>
          <div className="thread">
            {loading ? (
              <ThreadSkeleton />
            ) : notFound ? (
              <NotFoundState />
            ) : threadError ? (
              <LoadErrorState
                message={thread?.error ?? "Could not load this conversation."}
                onRetry={() => activeId && void loadThread(activeId).catch(() => {})}
              />
            ) : messages.length === 0 && !live ? (
              <EmptyState />
            ) : (
              <>
                {thread?.hasMore ? (
                  <div className="thread-earlier">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={showEarlier} disabled={thread.loadingEarlier}>
                      {thread.loadingEarlier ? <Icon name="loader" size={13} className="spin" /> : <Icon name="arrow-up" size={13} />}
                      Show earlier messages
                    </button>
                  </div>
                ) : null}
                <Thread
                  messages={messages}
                  retryId={retryId}
                  onCitation={onCitation}
                  onOpenSources={onOpenSources}
                  onRetry={onRetry}
                />
                {live ? (
                  <>
                    {live.question ? <UserBubble content={live.question} /> : null}
                    <WorkingAnswer
                      live={live}
                      providerName={searchProviderName(live.searchProvider)}
                      modelName={modelName}
                      onStop={() => activeId && streams.stop(activeId)}
                      onCitation={onLiveCitation}
                    />
                  </>
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
        onSubmit={() => void submit()}
        onStop={() => {
          if (live && activeId) streams.stop(activeId);
          else if (storedStreaming) {
            // The answer runs elsewhere: ask the server to stop it; the poll picks up the result.
            void api("/api/chat/stop", { method: "POST", body: JSON.stringify({ messageId: storedStreaming.id }) }).catch(
              (cause) => showToast(errorMessage(cause, "Could not stop the answer")),
            );
          }
        }}
        busy={!!live || followStored}
        stopping={!!live?.stopping}
        disabled={!ready || loadFailed || notFound}
        mode={mode}
        onModeChange={(next) => {
          if (summary) setConversationMode(summary.id, next);
          else setDraftMode(next);
        }}
        searchProvider={searchProvider}
        onSearchProviderChange={setDraftSearchProvider}
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
