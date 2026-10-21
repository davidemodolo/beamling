"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError, errorMessage } from "./api";
import { DEFAULT_CONVERSATION_TITLE, DEFAULT_SETTINGS, titleFromQuestion } from "./data";
import type {
  AppState,
  Conversation,
  ConversationPage,
  ConversationSummary,
  Credential,
  CredentialKind,
  BravePlan,
  BudgetPeriod,
  User,
  Message,
  Mode,
  Settings,
} from "./types";

/**
 * A message as the thread shows it. "failed" marks a question and error that never reached the
 * server (kept until the user retries); "provisional" marks streamed text shown because the reload
 * after an answer failed (replaced by the next successful load).
 */
export type ThreadMessage = Message & { local?: "failed" | "provisional" };

export interface ThreadState {
  status: "loading" | "ready" | "missing" | "error";
  conversation: ConversationSummary | null;
  messages: ThreadMessage[];
  hasMore: boolean;
  loadingEarlier: boolean;
  error?: string;
}

interface StoreValue {
  user: User | null;
  conversations: ConversationSummary[];
  hasMoreConversations: boolean;
  conversationCount: number;
  threads: Record<string, ThreadState>;
  settings: Settings;
  credentials: Credential[];
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
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
  deleteConversation: (id: string) => void;
  setConversationMode: (id: string, mode: Mode) => void;
  setConversationPinned: (id: string, pinned: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  addCredential: (input: {
    kind: CredentialKind;
    provider: string;
    key: string;
    plan?: BravePlan;
    expiresOn?: string | null;
    budgetUsd?: number | null;
    budgetPeriod?: BudgetPeriod | null;
  }) => Promise<Credential>;
  updateCredentialLimits: (
    id: string,
    patch: { plan?: BravePlan; expiresOn?: string | null; budgetUsd?: number | null; budgetPeriod?: BudgetPeriod | null },
  ) => Promise<Credential>;
  removeCredential: (id: string) => Promise<void>;
  validateCredential: (id: string) => Promise<Credential | undefined>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

function toSummary(conversation: Conversation): ConversationSummary {
  const { id, title, mode, pinned, createdAt, updatedAt } = conversation;
  return { id, title, mode, pinned, createdAt, updatedAt };
}

export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function upsertSummary(list: ConversationSummary[], summary: ConversationSummary): ConversationSummary[] {
  return list.some((item) => item.id === summary.id)
    ? list.map((item) => (item.id === summary.id ? summary : item))
    : [summary, ...list];
}

/**
 * Merges a freshly loaded newest page into the thread: earlier pages the user already loaded are
 * kept, provisional copies are dropped, and failed local messages stay at the end.
 */
function mergeThread(previous: ThreadState | undefined, conversation: Conversation): ThreadState {
  const page = conversation.messages;
  const pageIds = new Set(page.map((message) => message.id));
  const firstAt = page[0]?.createdAt;
  const stored = previous?.messages.filter((message) => !message.local) ?? [];
  // Earlier pages are kept only when the new page overlaps them. A complete page replaces
  // everything, and a page with no overlap (many messages arrived elsewhere) would leave a gap.
  const contiguous = conversation.hasMoreMessages && stored.some((message) => pageIds.has(message.id));
  const earlier =
    firstAt && contiguous
      ? stored.filter((message) => !pageIds.has(message.id) && message.createdAt < firstAt)
      : [];
  const failed = previous?.messages.filter((message) => message.local === "failed") ?? [];
  return {
    status: "ready",
    conversation: toSummary(conversation),
    messages: [...earlier, ...page, ...failed],
    hasMore: earlier.length ? (previous?.hasMore ?? false) : conversation.hasMoreMessages,
    loadingEarlier: false,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [conversationCount, setConversationCount] = useState(0);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  // Requests are numbered so a slow, older response never overwrites a newer one.
  const refreshSeq = useRef(0);
  const threadSeq = useRef(new Map<string, number>());
  // Conversations created or deleted while a full refresh was in flight, keyed by the refresh they followed.
  const createdAfter = useRef(new Map<string, number>());
  const deleted = useRef(new Set<string>());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const patchThread = useCallback((id: string, update: (thread: ThreadState) => ThreadState) => {
    setThreads((current) => (current[id] ? { ...current, [id]: update(current[id]) } : current));
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const state = await api<AppState>("/api/state");
      if (seq !== refreshSeq.current) return;
      setUser(state.user);
      setConversations((current) => {
        const fresh = state.conversations.filter((item) => !deleted.current.has(item.id));
        const created = current.filter(
          (item) => (createdAfter.current.get(item.id) ?? -1) >= seq && !fresh.some((other) => other.id === item.id),
        );
        return [...created, ...fresh];
      });
      setNextCursor(state.nextCursor);
      setConversationCount(state.conversationCount);
      setCredentials(state.credentials);
      setSettings(state.settings);
      setError(null);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === "UNAUTHENTICATED") {
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (seq === refreshSeq.current) setError(errorMessage(cause, "Could not load the workspace."));
    } finally {
      if (seq === refreshSeq.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    setThreads((current) =>
      current[id]
        ? current
        : {
            ...current,
            [id]: { status: "loading", conversation: null, messages: [], hasMore: false, loadingEarlier: false },
          },
    );
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
        const previous = current[id];
        // A thread that is already on screen stays as it is; only a first load shows the failure.
        if (previous?.status === "ready" && !missing) return current;
        return {
          ...current,
          [id]: {
            status: missing ? "missing" : "error",
            conversation: null,
            messages: [],
            hasMore: false,
            loadingEarlier: false,
            error: errorMessage(cause, "Could not load this conversation."),
          },
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

  const createConversation = useCallback(async (mode: Mode) => {
    const { conversation } = await api<{ conversation: ConversationSummary }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    createdAfter.current.set(conversation.id, refreshSeq.current);
    setConversations((current) => upsertSummary(current, conversation));
    setConversationCount((count) => count + 1);
    setThreads((current) => ({
      ...current,
      [conversation.id]: { status: "ready", conversation, messages: [], hasMore: false, loadingEarlier: false },
    }));
    return conversation;
  }, []);

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

  const deleteConversation = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      setConversationCount((count) => Math.max(0, count - 1));
      setThreads((current) => withoutKey(current, id));
      void api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {
        deleted.current.delete(id);
        void refresh();
      });
    },
    [refresh],
  );

  const setConversationMode = useCallback(
    (id: string, mode: Mode) => {
      patchConversation(id, { mode });
      void api(`/api/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      }).catch(() => void refresh());
    },
    [patchConversation, refresh],
  );

  const setConversationPinned = useCallback(
    (id: string, pinned: boolean) => {
      patchConversation(id, { pinned });
      void api(`/api/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned }),
      }).catch(() => void refresh());
    },
    [patchConversation, refresh],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      // Roll back only the keys this call changed, so a concurrent update is not clobbered.
      const previous = Object.fromEntries(
        (Object.keys(patch) as (keyof Settings)[]).map((key) => [key, settingsRef.current[key]]),
      ) as Partial<Settings>;
      setSettings((current) => ({ ...current, ...patch }));
      try {
        const { settings: saved } = await api<{ settings: Settings }>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        setSettings(saved);
        return saved;
      } catch (cause) {
        setSettings((current) => ({ ...current, ...previous }));
        void refresh();
        throw cause;
      }
    },
    [refresh],
  );

  const addCredential = useCallback(async (input: {
    kind: CredentialKind;
    provider: string;
    key: string;
    plan?: BravePlan;
    expiresOn?: string | null;
    budgetUsd?: number | null;
    budgetPeriod?: BudgetPeriod | null;
  }) => {
    const { credential } = await api<{ credential: Credential }>("/api/credentials", {
      method: "POST",
      body: JSON.stringify(input),
      // Validation calls the provider, which can take a while.
      timeoutMs: 45_000,
    });
    setCredentials((current) => [
      ...current.filter((item) => !(item.kind === credential.kind && item.provider === credential.provider)),
      credential,
    ]);
    return credential;
  }, []);

  const updateCredentialLimits = useCallback(async (
    id: string,
    patch: { plan?: BravePlan; expiresOn?: string | null; budgetUsd?: number | null; budgetPeriod?: BudgetPeriod | null },
  ) => {
    const { credential } = await api<{ credential: Credential }>(`/api/credentials/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setCredentials((current) => current.map((item) => (item.id === id ? credential : item)));
    return credential;
  }, []);

  const removeCredential = useCallback(async (id: string) => {
    await api(`/api/credentials/${id}`, { method: "DELETE" });
    setCredentials((current) => current.filter((credential) => credential.id !== id));
  }, []);

  const validateCredential = useCallback(async (id: string) => {
    const replace = (credential: Credential) =>
      setCredentials((current) => current.map((item) => (item.id === id ? credential : item)));
    try {
      const { credential } = await api<{ credential: Credential }>(`/api/credentials/${id}/validate`, {
        method: "POST",
        timeoutMs: 45_000,
      });
      replace(credential);
      return credential;
    } catch (cause) {
      // A failed check returns the status the server recorded (rejected, rate limited).
      const stored = cause instanceof ApiRequestError ? (cause.body?.credential as Credential | undefined) : undefined;
      if (stored) replace(stored);
      throw cause;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.replace("/");
  }, []);

  const deleteAccount = useCallback(async () => {
    await api("/api/account", { method: "DELETE" });
    setUser(null);
    setConversations([]);
    setNextCursor(null);
    setConversationCount(0);
    setThreads({});
    setCredentials([]);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      user,
      conversations,
      hasMoreConversations: nextCursor !== null,
      conversationCount,
      threads,
      settings,
      credentials,
      ready,
      error,
      refresh,
      loadMoreConversations,
      loadThread,
      loadEarlierMessages,
      createConversation,
      patchConversation,
      titleFromFirstQuestion,
      dropFailedMessages,
      addMessages,
      updateMessage,
      removeMessages,
      deleteConversation,
      setConversationMode,
      setConversationPinned,
      updateSettings,
      addCredential,
      removeCredential,
      validateCredential,
      updateCredentialLimits,
      signOut,
      deleteAccount,
    }),
    [
      user,
      conversations,
      nextCursor,
      conversationCount,
      threads,
      settings,
      credentials,
      ready,
      error,
      refresh,
      loadMoreConversations,
      loadThread,
      loadEarlierMessages,
      createConversation,
      patchConversation,
      titleFromFirstQuestion,
      dropFailedMessages,
      addMessages,
      updateMessage,
      removeMessages,
      deleteConversation,
      setConversationMode,
      setConversationPinned,
      updateSettings,
      addCredential,
      removeCredential,
      validateCredential,
      updateCredentialLimits,
      signOut,
      deleteAccount,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}
