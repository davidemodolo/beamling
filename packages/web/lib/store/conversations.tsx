"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type RefObject } from "react";
import { api, ApiRequestError, errorMessage } from "../api";
import { deleteConversationImages } from "../image-store";
import { DEFAULT_CONVERSATION_TITLE, titleFromQuestion } from "../data";
import type { AppState, Conversation, ConversationPage, ConversationSummary, Message, Mode } from "../types";
import { mergeThread, toSummary, upsertSummary, type ThreadMessage, type ThreadState } from "./threads";

export interface ConversationsValue {
  conversations: ConversationSummary[];
  hasMoreConversations: boolean;
  conversationCount: number;
  threads: Record<string, ThreadState>;
  loadMoreConversations: () => Promise<void>;
  loadThread: (id: string) => Promise<Conversation>;
  loadEarlierMessages: (id: string) => Promise<void>;
  createConversation: (mode: Mode) => Promise<ConversationSummary>;
  patchConversation: (id: string, patch: Partial<ConversationSummary>) => void;
  /** Removes questions and errors that never reached the server, e.g. when a new question starts. */
  dropFailedMessages: (conversationId: string) => void;
  /** Titles a still-untitled conversation after its first question, as the server will. */
  titleFromFirstQuestion: (id: string, question: string) => void;
  addMessages: (conversationId: string, messages: ThreadMessage[]) => void;
  updateMessage: (conversationId: string, messageId: string, update: (message: ThreadMessage) => ThreadMessage) => void;
  removeMessages: (conversationId: string, messageIds: string[]) => void;
  /** Deletes several conversations in one request; resolves once the server confirms. */
  deleteConversations: (ids: string[]) => Promise<void>;
  /** Drops conversations, and this device's images of them, that the server already deleted (e.g. the per-account cap). */
  forgetConversations: (ids: string[]) => void;
  setConversationMode: (id: string, mode: Mode) => void;
  setConversationPinned: (id: string, pinned: boolean) => void;
}

export const ConversationsContext = createContext<ConversationsValue | null>(null);

export function useConversations(): ConversationsValue {
  const value = useContext(ConversationsContext);
  if (!value) throw new Error("useConversations must be used inside StoreProvider");
  return value;
}

const emptyThread = (status: ThreadState["status"]): ThreadState => ({
  status,
  conversation: null,
  messages: [],
  hasMore: false,
  loadingEarlier: false,
});

/**
 * Conversation list and threads. `refreshSeq` numbers full workspace refreshes so a conversation
 * created during one survives its (older) response; `resync` reloads the workspace after a failed
 * optimistic update.
 */
export function useConversationsSlice({ refreshSeq, resync }: { refreshSeq: RefObject<number>; resync: () => void }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [conversationCount, setConversationCount] = useState(0);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  // Thread loads are numbered so a slow, older response never overwrites a newer one.
  const threadSeq = useRef(new Map<string, number>());
  // Conversations created or deleted while a full refresh was in flight, keyed by the refresh they followed.
  const createdAfter = useRef(new Map<string, number>());
  const deleted = useRef(new Set<string>());

  const patchThread = useCallback((id: string, update: (thread: ThreadState) => ThreadState) => {
    setThreads((current) => (current[id] ? { ...current, [id]: update(current[id]) } : current));
  }, []);

  /** Applies a workspace refresh numbered `seq`, keeping local creations and deletions made since. */
  const applyState = useCallback((state: AppState, seq: number) => {
    setConversations((current) => {
      const fresh = state.conversations.filter((item) => !deleted.current.has(item.id));
      const created = current.filter(
        (item) => (createdAfter.current.get(item.id) ?? -1) >= seq && !fresh.some((other) => other.id === item.id),
      );
      return [...created, ...fresh];
    });
    setNextCursor(state.nextCursor);
    setConversationCount(state.conversationCount);
  }, []);

  const reset = useCallback(() => {
    setConversations([]);
    setNextCursor(null);
    setConversationCount(0);
    setThreads({});
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor) return;
    const page = await api<ConversationPage>(`/api/conversations?cursor=${encodeURIComponent(nextCursor)}`);
    setConversations((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...current, ...page.conversations.filter((item) => !known.has(item.id) && !deleted.current.has(item.id))];
    });
    setNextCursor(page.nextCursor);
  }, [nextCursor]);

  const loadThread = useCallback(async (id: string): Promise<Conversation> => {
    const seq = (threadSeq.current.get(id) ?? 0) + 1;
    threadSeq.current.set(id, seq);
    setThreads((current) => (current[id] ? current : { ...current, [id]: emptyThread("loading") }));
    try {
      const { conversation } = await api<{ conversation: Conversation }>(`/api/conversations/${id}`);
      if (threadSeq.current.get(id) !== seq) return conversation;
      setThreads((current) => ({ ...current, [id]: mergeThread(current[id], conversation) }));
      if (!deleted.current.has(id)) setConversations((current) => upsertSummary(current, toSummary(conversation)));
      return conversation;
    } catch (cause) {
      if (threadSeq.current.get(id) !== seq) throw cause;
      const missing = cause instanceof ApiRequestError && cause.status === 404;
      setThreads((current) => {
        // A thread that is already on screen stays as it is; only a first load shows the failure.
        if (current[id]?.status === "ready" && !missing) return current;
        return {
          ...current,
          [id]: { ...emptyThread(missing ? "missing" : "error"), error: errorMessage(cause, "Could not load this conversation.") },
        };
      });
      throw cause;
    }
  }, []);

  const loadEarlierMessages = useCallback(
    async (id: string) => {
      const thread = threads[id];
      const oldest = thread?.messages.find((message) => !message.local);
      if (!thread || !oldest || !thread.hasMore || thread.loadingEarlier) return;
      patchThread(id, (current) => ({ ...current, loadingEarlier: true }));
      try {
        const page = await api<{ messages: Message[]; hasMore: boolean }>(
          `/api/conversations/${id}/messages?before=${encodeURIComponent(oldest.id)}`,
        );
        patchThread(id, (current) => {
          const known = new Set(current.messages.map((message) => message.id));
          return {
            ...current,
            messages: [...page.messages.filter((message) => !known.has(message.id)), ...current.messages],
            hasMore: page.hasMore,
            loadingEarlier: false,
          };
        });
      } catch (cause) {
        patchThread(id, (current) => ({ ...current, loadingEarlier: false }));
        throw cause;
      }
    },
    [threads, patchThread],
  );

  const createConversation = useCallback(
    async (mode: Mode) => {
      const { conversation } = await api<{ conversation: ConversationSummary }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      createdAfter.current.set(conversation.id, refreshSeq.current);
      setConversations((current) => upsertSummary(current, conversation));
      setConversationCount((count) => count + 1);
      setThreads((current) => ({ ...current, [conversation.id]: { ...emptyThread("ready"), conversation } }));
      return conversation;
    },
    [refreshSeq],
  );

  const patchConversation = useCallback(
    (id: string, patch: Partial<ConversationSummary>) => {
      setConversations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
      patchThread(id, (thread) => (thread.conversation ? { ...thread, conversation: { ...thread.conversation, ...patch } } : thread));
    },
    [patchThread],
  );

  const dropFailedMessages = useCallback(
    (conversationId: string) => {
      patchThread(conversationId, (thread) =>
        thread.messages.some((message) => message.local === "failed")
          ? { ...thread, messages: thread.messages.filter((message) => message.local !== "failed") }
          : thread,
      );
    },
    [patchThread],
  );

  const titleFromFirstQuestion = useCallback(
    (id: string, question: string) => {
      // Decided inside the updaters, so a conversation created a moment ago is seen too.
      const retitle = <T extends { title: string }>(item: T): T =>
        item.title === DEFAULT_CONVERSATION_TITLE ? { ...item, title: titleFromQuestion(question) } : item;
      setConversations((current) => current.map((item) => (item.id === id ? retitle(item) : item)));
      patchThread(id, (thread) => (thread.conversation ? { ...thread, conversation: retitle(thread.conversation) } : thread));
    },
    [patchThread],
  );

  const addMessages = useCallback(
    (conversationId: string, added: ThreadMessage[]) => {
      // Re-adding a message replaces it, so a provisional copy never duplicates a loaded one.
      const ids = new Set(added.map((message) => message.id));
      patchThread(conversationId, (thread) => ({
        ...thread,
        messages: [...thread.messages.filter((message) => !ids.has(message.id)), ...added],
      }));
    },
    [patchThread],
  );

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, update: (message: ThreadMessage) => ThreadMessage) => {
      patchThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) => (message.id === messageId ? update(message) : message)),
      }));
    },
    [patchThread],
  );

  const removeMessages = useCallback(
    (conversationId: string, messageIds: string[]) => {
      const ids = new Set(messageIds);
      patchThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => !ids.has(message.id)),
      }));
    },
    [patchThread],
  );

  /** Drops conversations from the list and the threads. */
  const hideConversations = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    for (const id of ids) deleted.current.add(id);
    setConversations((current) => current.filter((conversation) => !gone.has(conversation.id)));
    setConversationCount((count) => Math.max(0, count - ids.length));
    setThreads((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !gone.has(id))));
  }, []);

  const forgetConversations = useCallback(
    (ids: string[]) => {
      hideConversations(ids);
      void deleteConversationImages(ids);
    },
    [hideConversations],
  );

  /**
   * Optimistic: the conversations disappear at once; a failed request reloads the workspace. Images
   * are deleted only once the server confirms, since this device holds their only copy.
   */
  const deleteConversations = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      hideConversations(ids);
      try {
        await api("/api/conversations/delete", { method: "POST", body: JSON.stringify({ ids }) });
      } catch (cause) {
        for (const id of ids) deleted.current.delete(id);
        resync();
        throw cause;
      }
      void deleteConversationImages(ids);
    },
    [hideConversations, resync],
  );

  /** Optimistic mode or pin change; a failed request reloads the workspace. */
  const saveConversation = useCallback(
    (id: string, patch: { mode: Mode } | { pinned: boolean }) => {
      patchConversation(id, patch);
      void api(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(resync);
    },
    [patchConversation, resync],
  );
  const setConversationMode = useCallback((id: string, mode: Mode) => saveConversation(id, { mode }), [saveConversation]);
  const setConversationPinned = useCallback(
    (id: string, pinned: boolean) => saveConversation(id, { pinned }),
    [saveConversation],
  );

  const value = useMemo<ConversationsValue>(
    () => ({
      conversations,
      hasMoreConversations: nextCursor !== null,
      conversationCount,
      threads,
      loadMoreConversations,
      loadThread,
      loadEarlierMessages,
      createConversation,
      patchConversation,
      dropFailedMessages,
      titleFromFirstQuestion,
      addMessages,
      updateMessage,
      removeMessages,
      deleteConversations,
      forgetConversations,
      setConversationMode,
      setConversationPinned,
    }),
    [
      conversations,
      nextCursor,
      conversationCount,
      threads,
      loadMoreConversations,
      loadThread,
      loadEarlierMessages,
      createConversation,
      patchConversation,
      dropFailedMessages,
      titleFromFirstQuestion,
      addMessages,
      updateMessage,
      removeMessages,
      deleteConversations,
      forgetConversations,
      setConversationMode,
      setConversationPinned,
    ],
  );

  return { value, applyState, reset };
}
