"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "./sidebar-context";
import { ChatTopbar } from "./chat/chat-topbar";
import { useFollowStoredAnswer } from "./chat/use-follow-stored-answer";
import { useSourcesPanel } from "./chat/use-sources-panel";
import { useImageDraft } from "./chat/use-image-draft";
import { useThreadScroll } from "./chat/use-thread-scroll";
import { EmptyState, LoadErrorState, NotFoundState, Thread, ThreadSkeleton, UserBubble, WorkingAnswer } from "./chat-thread";
import { Composer } from "./composer";
import { SourcesPanel, SourcesSheet } from "./sources";
import { Icon } from "./ui/icon";
import { useAnswerStreams, type LiveAnswer } from "@/lib/answer-streams";
import { toAttachment, toFileAttachment } from "@/lib/attachments";
import { api, errorMessage } from "@/lib/api";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useToast } from "@/lib/hooks/use-toast";
import { isSearchProvider } from "@/lib/contracts";
import { llmModelName, modelReadsImages, searchProviderName, setupState, usableProviders } from "@/lib/provider-catalog";
import { useAccount, useConversations, type ThreadMessage } from "@/lib/store";
import { MODE_LABELS } from "@/lib/modes";
import { takeSearchRequest, type SearchRequest } from "@/lib/search-request";
import type { Mode, SearchProvider } from "@/lib/types";
import { collapseWhitespace } from "@/lib/utils";

interface ChatViewProps {
  conversationId?: string;
  /** On /search: a question may be waiting in the URL fragment; `auto` allows sending it without a click. */
  search?: { auto: boolean };
}

export function ChatView({ conversationId, search }: ChatViewProps) {
  const pathname = usePathname();
  const [session, setSession] = useState(0);
  const [previousPath, setPreviousPath] = useState(pathname);
  if (pathname !== previousPath) {
    setPreviousPath(pathname);
    // A new chat rewrites the URL to /chat/{id} without remounting. Coming back to /
    // ("New question", or deleting the active conversation) must start from a clean view.
    if (!conversationId && pathname === "/") setSession((value) => value + 1);
  }
  // One pane per conversation, so a view never shows another conversation's state.
  return <ChatPane key={conversationId ?? `draft-${session}`} conversationId={conversationId} search={search} />;
}

/** Hides the stored rows of the exchange that is streaming; the live answer stands in for them. */
function visibleMessages(messages: ThreadMessage[], live: LiveAnswer | undefined): ThreadMessage[] {
  if (!live) return messages;
  const hidden = new Set([live.messageId, live.replaces, live.replacesQuestion, live.ask ? live.userMessageId : null]);
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

/**
 * The latest stored exchange, when its answer can be replaced: regenerated as it is, or after its
 * question is edited. Only the latest, so a conversation never branches.
 */
function latestExchange(messages: ThreadMessage[]): { questionId: string; answerId: string; complete: boolean } | undefined {
  const answer = messages.at(-1);
  const question = messages.at(-2);
  if (!answer || !question || answer.role !== "assistant" || question.role !== "user") return undefined;
  if (answer.local || question.local || answer.status === "streaming" || answer.status === "pending") return undefined;
  return { questionId: question.id, answerId: answer.id, complete: answer.status === "complete" };
}

function ChatPane({ conversationId, search }: ChatViewProps) {
  const { openSidebar, openSettings } = useSidebar();
  const { ready, error, user, settings, credentials } = useAccount();
  const { conversations, threads, loadThread, loadEarlierMessages, createConversation, setConversationMode, removeMessages } = useConversations();
  const streams = useAnswerStreams();
  const isMobile = useIsMobile();
  const [toast, showToast] = useToast();

  // Set once a new chat has created its conversation (the URL is rewritten in place).
  const [localId, setLocalId] = useState<string | null>(null);
  const activeId = conversationId ?? localId;
  const thread = activeId ? threads[activeId] : undefined;
  const summary = (activeId ? conversations.find((c) => c.id === activeId) : undefined) ?? thread?.conversation ?? undefined;
  const live = activeId ? streams.live[activeId] : undefined;
  const messages = useMemo(() => visibleMessages(thread?.messages ?? [], live), [thread, live]);

  const [input, setInput] = useState("");
  const imageDraft = useImageDraft(showToast);
  // Mode picked before the first question; kept local so it does not change the saved default.
  const [draftMode, setDraftMode] = useState<Mode | null>(null);
  const mode = summary?.mode ?? draftMode ?? settings.defaultMode;
  const pickedMode = mode;
  const [draftSearchProvider, setDraftSearchProvider] = useState<SearchProvider | null>(null);
  const searchProvider = draftSearchProvider ?? settings.defaultSearchProvider;
  // Marks keyless providers in the picker only. Sending is not blocked here: the store can be stale
  // (a key added in another tab), and the server answers a missing key with a "Key needed" card.
  const keyedProviders = useMemo(
    () => new Set(credentials.map((credential) => credential.provider)),
    [credentials],
  );

  const sources = useSourcesPanel({ live, messages, searchProvider, isMobile, showToast });
  const { threadRef, onScroll: onThreadScroll, stick, release } = useThreadScroll({
    liveText: live?.content,
    liveStage: live?.stage,
    messageCount: messages.length,
  });
  const storedStreaming = useFollowStoredAnswer({
    conversationId: activeId,
    messages: thread?.messages,
    streamingHere: !!live,
    reload: loadThread,
  });
  const followStored = !!storedStreaming;

  // The answer that just finished streaming here; the mascot lights its sources for a moment.
  const [streamedId, setStreamedId] = useState<string | null>(live?.messageId ?? null);
  const [litId, setLitId] = useState<string | null>(null);
  const liveId = live?.messageId ?? null;
  if (liveId && liveId !== streamedId) setStreamedId(liveId);
  if (!live && streamedId) {
    setStreamedId(null);
    setLitId(streamedId);
  }
  useEffect(() => {
    if (!litId) return;
    const timer = window.setTimeout(() => setLitId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [litId]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  // Return focus to the composer when an answer finishes.
  useEffect(() => {
    if (wasLiveRef.current && !live && !isMobile) inputRef.current?.focus();
    wasLiveRef.current = !!live;
  }, [live, isMobile]);

  const { reset: resetSources } = sources;
  const beforeStart = useCallback(() => {
    resetSources();
    stick();
  }, [resetSources, stick]);

  const submit = useCallback(async (asked?: SearchRequest) => {
    const question = collapseWhitespace(asked?.question ?? input);
    const mode = asked?.mode ?? pickedMode;
    const { images, files } = imageDraft;
    if ((!question && !images.length && !files.length) || imageDraft.adding || live || followStored || creatingRef.current) return;
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
      if (["/", "/search"].includes(window.location.pathname)) window.history.replaceState(null, "", `/chat/${id}`);
    }
    const ask = { text: question, attachments: [...images.map(toAttachment), ...files.map(toFileAttachment)] };
    if (streams.start({ conversationId: id, mode, searchProvider, ask, picked: images, pickedFiles: files })) {
      setInput("");
      imageDraft.clear();
      beforeStart();
    }
  }, [input, imageDraft, live, followStored, activeId, createConversation, pickedMode, searchProvider, showToast, streams, beforeStart]);

  // A question from the address bar: fill the composer, and send it when the navigation allows.
  const searchHandled = useRef(false);
  useEffect(() => {
    if (!search || searchHandled.current || !ready || !user) return;
    searchHandled.current = true;
    const pending = takeSearchRequest();
    if (!pending) return;
    if (search.auto && pending.fresh) {
      void submit(pending);
      return;
    }
    // Not sent: the question waits in the composer (after the render that read it).
    queueMicrotask(() => {
      setInput(pending.question);
      if (pending.mode) setDraftMode(pending.mode);
    });
  }, [search, ready, user, submit]);

  const onRetry = useCallback(
    (messageId: string) => {
      if (!activeId || live) return;
      const list = thread?.messages ?? [];
      const index = list.findIndex((message) => message.id === messageId);
      const failed = list[index];
      if (!failed) return;
      if (failed.local) {
        // Never stored: ask the same question again as a new one, with the images this device kept.
        const question = list.slice(0, index).findLast((message) => message.role === "user");
        if (!question) return;
        const ask = { text: question.content, attachments: question.attachments ?? [] };
        if (streams.start({ conversationId: activeId, mode, searchProvider, ask })) {
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

  const exchange = live || followStored ? undefined : latestExchange(messages);

  /** A new answer for the latest question, with the mode and provider picked in the composer. */
  const onRegenerate = useCallback(
    (answerId: string) => {
      if (!activeId || live) return;
      if (streams.start({ conversationId: activeId, mode, searchProvider, retryOf: answerId, onRefused: showToast })) beforeStart();
    },
    [activeId, live, streams, mode, searchProvider, showToast, beforeStart],
  );

  /** Rewrites the latest question and answers it again. */
  const onEdit = useCallback(
    (questionId: string, text: string) => {
      const list = thread?.messages ?? [];
      const index = list.findIndex((message) => message.id === questionId);
      const question = list[index];
      const answer = list[index + 1];
      if (!activeId || live || !question || answer?.role !== "assistant") return;
      const ask = { text: collapseWhitespace(text), attachments: question.attachments ?? [] };
      if (!ask.text && !ask.attachments.length) return;
      if (streams.start({ conversationId: activeId, mode, searchProvider, ask, retryOf: answer.id, editOf: question.id, onRefused: showToast })) {
        beforeStart();
      }
    },
    [activeId, live, thread, streams, mode, searchProvider, showToast, beforeStart],
  );

  const stop = () => {
    if (live && activeId) streams.stop(activeId);
    else if (storedStreaming) {
      // The answer runs elsewhere: ask the server to stop it; the poll picks up the result.
      void api("/api/chat/stop", { method: "POST", body: JSON.stringify({ messageId: storedStreaming.id }) }).catch(
        (cause) => showToast(errorMessage(cause, "Could not stop the answer")),
      );
    }
  };

  const showEarlier = () => {
    if (!activeId) return;
    release();
    loadEarlierMessages(activeId).catch((cause) => showToast(errorMessage(cause, "Could not load earlier messages")));
  };

  const modelName = llmModelName(settings.llmModel);
  // A failed initial load is shown by the shell; don't claim the conversation is missing.
  const loadFailed = !!error && !user;
  const loading = !!conversationId && (!ready || !thread || thread.status === "loading");
  const notFound = !!conversationId && !loadFailed && thread?.status === "missing";
  const threadError = !!conversationId && thread?.status === "error";
  const retryId = live ? undefined : retryableId(messages);
  // Keys deleted in Settings during this visit; opening / again goes back to setup.
  const setupMissing = ready && !!user && !setupState(usableProviders(credentials)).complete;

  return (
    <main className="main-pane" id="main">
      <ChatTopbar
        title={summary?.title ?? (conversationId ? "Loading…" : "New question")}
        subtitle={`${MODE_LABELS[mode]} · ${modelName} · ${searchProviderName(searchProvider)}`}
        user={user}
        isMobile={isMobile}
        sources={{
          count: sources.sources.length,
          loading: sources.loading,
          hidden: sources.hidden,
          panelOpen: sources.panelOpen,
          sheetOpen: sources.sheetOpen,
          onToggle: sources.toggle,
        }}
        onOpenSidebar={openSidebar}
        onOpenSettings={() => openSettings()}
      />

      <div className={`chat-layout ${sources.panelOpen ? "with-sources" : ""}`}>
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
              <EmptyState attentive={!!input.trim()} onFinishSetup={setupMissing ? () => openSettings(setupState(usableProviders(credentials)).hasModelKey ? "search" : "models") : undefined} />
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
                  editId={exchange?.questionId}
                  regenerateId={exchange?.complete ? exchange.answerId : undefined}
                  litId={litId}
                  onEdit={onEdit}
                  onRegenerate={onRegenerate}
                  onCitation={sources.onCitation}
                  onOpenSources={sources.onOpenSources}
                  onRetry={onRetry}
                />
                {live ? (
                  <>
                    {live.ask ? <UserBubble content={live.ask.text} attachments={live.ask.attachments} /> : null}
                    <WorkingAnswer
                      live={live}
                      providerName={searchProviderName(live.searchProvider)}
                      modelName={modelName}
                      onStop={() => activeId && streams.stop(activeId)}
                      onCitation={sources.onLiveCitation}
                    />
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        {sources.panelOpen ? (
          <SourcesPanel
            sources={sources.sources}
            active={sources.activeSource}
            loading={sources.loading}
            onSelect={sources.selectSource}
            provider={sources.providerName}
            onClose={sources.closePanel}
            lit={!!litId}
          />
        ) : null}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => void submit()}
        onStop={stop}
        busy={!!live || followStored}
        stopping={!!live?.stopping}
        disabled={!ready || loadFailed || notFound}
        mode={mode}
        onModeChange={(next) => {
          if (summary) setConversationMode(summary.id, next);
          else setDraftMode(next);
        }}
        searchProvider={searchProvider}
        keyedProviders={keyedProviders}
        onSearchProviderChange={setDraftSearchProvider}
        modelLabel={modelName}
        inputRef={inputRef}
        attach={{
          ...imageDraft,
          modelReadsImages: modelReadsImages(settings.llmModel),
          onChangeModel: () => openSettings("models"),
        }}
      />

      <SourcesSheet
        open={sources.sheetOpen}
        onClose={sources.closeSheet}
        sources={sources.sources}
        active={sources.activeSource}
        loading={sources.loading}
        onSelect={sources.onSheetSelect}
        provider={sources.providerName}
      />

      {toast}
    </main>
  );
}
