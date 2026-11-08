"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "./sidebar-context";
import { ChatTopbar } from "./chat/chat-topbar";
import { useFollowStoredAnswer } from "./chat/use-follow-stored-answer";
import { useSourcesPanel } from "./chat/use-sources-panel";
import { useThreadScroll } from "./chat/use-thread-scroll";
import { EmptyState, LoadErrorState, NotFoundState, Thread, ThreadSkeleton, UserBubble, WorkingAnswer } from "./chat-thread";
import { Composer } from "./composer";
import { SourcesPanel, SourcesSheet } from "./sources";
import { Icon } from "./ui/icon";
import { useAnswerStreams, type LiveAnswer } from "@/lib/answer-streams";
import { api, errorMessage } from "@/lib/api";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useToast } from "@/lib/hooks/use-toast";
import { isSearchProvider } from "@/lib/contracts";
import { llmModelName, searchProviderName, setupState, usableProviders } from "@/lib/provider-catalog";
import { useAccount, useConversations, type ThreadMessage } from "@/lib/store";
import { MODE_LABELS } from "@/lib/modes";
import type { Mode, SearchProvider } from "@/lib/types";
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
    // A new chat rewrites the URL to /chat/{id} without remounting. Coming back to /
    // ("New question", or deleting the active conversation) must start from a clean view.
    if (!conversationId && pathname === "/") setSession((value) => value + 1);
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
  // Mode picked before the first question; kept local so it does not change the saved default.
  const [draftMode, setDraftMode] = useState<Mode | null>(null);
  const mode = summary?.mode ?? draftMode ?? settings.defaultMode;
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
      if (window.location.pathname === "/") window.history.replaceState(null, "", `/chat/${id}`);
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
              <EmptyState onFinishSetup={setupMissing ? () => openSettings(setupState(usableProviders(credentials)).hasModelKey ? "search" : "models") : undefined} />
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
                  onCitation={sources.onCitation}
                  onOpenSources={sources.onOpenSources}
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
