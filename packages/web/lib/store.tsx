"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "./api";
import { DEFAULT_SETTINGS } from "./data";
import type {
  AppState,
  Conversation,
  Credential,
  CredentialKind,
  GuestUser,
  Message,
  Mode,
  Settings,
} from "./types";
import { collapseWhitespace } from "./utils";

interface StoreValue {
  user: GuestUser | null;
  conversations: Conversation[];
  settings: Settings;
  credentials: Credential[];
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshConversation: (id: string) => Promise<void>;
  createConversation: (mode: Mode) => Promise<Conversation>;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, update: (message: Message) => Message) => void;
  deleteConversation: (id: string) => void;
  setConversationMode: (id: string, mode: Mode) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  addCredential: (input: { kind: CredentialKind; provider: string; key: string }) => Promise<Credential>;
  removeCredential: (id: string) => Promise<void>;
  validateCredential: (id: string) => Promise<Credential | undefined>;
  deleteAccount: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY = {
  conversations: [] as Conversation[],
  credentials: [] as Credential[],
  settings: DEFAULT_SETTINGS,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<GuestUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(EMPTY.conversations);
  const [credentials, setCredentials] = useState<Credential[]>(EMPTY.credentials);
  const [settings, setSettings] = useState<Settings>(EMPTY.settings);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applyState = useCallback((state: AppState) => {
    setUser(state.user);
    setConversations(state.conversations);
    setCredentials(state.credentials);
    setSettings(state.settings);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const state = await api<AppState>("/api/state");
      applyState(state);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load the workspace."));
    } finally {
      setReady(true);
    }
  }, [applyState]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the guest workspace from the server
    void refresh();
  }, [refresh]);

  const refreshConversation = useCallback(async (id: string) => {
    const { conversation } = await api<{ conversation: Conversation }>(`/api/conversations/${id}`);
    setConversations((current) => {
      const exists = current.some((item) => item.id === id);
      return exists
        ? current.map((item) => (item.id === id ? conversation : item))
        : [conversation, ...current];
    });
  }, []);

  const createConversation = useCallback(async (mode: Mode) => {
    const { conversation } = await api<{ conversation: Conversation }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    setConversations((current) => [conversation, ...current]);
    return conversation;
  }, []);

  const addMessage = useCallback((conversationId: string, message: Message) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, message],
              title:
                conversation.title === "New conversation" && message.role === "user"
                  ? collapseWhitespace(message.content).slice(0, 48) || "New conversation"
                  : conversation.title,
              updatedAt: message.createdAt,
            }
          : conversation,
      ),
    );
  }, []);

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, update: (message: Message) => Message) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) => (message.id === messageId ? update(message) : message)),
              }
            : conversation,
        ),
      );
    },
    [],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      void api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => void refresh());
    },
    [refresh],
  );

  const setConversationMode = useCallback(
    (id: string, mode: Mode) => {
      setConversations((current) =>
        current.map((conversation) => (conversation.id === id ? { ...conversation, mode } : conversation)),
      );
      void api(`/api/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      }).catch(() => void refresh());
    },
    [refresh],
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

  const addCredential = useCallback(async (input: { kind: CredentialKind; provider: string; key: string }) => {
    const { credential } = await api<{ credential: Credential }>("/api/credentials", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setCredentials((current) => [
      ...current.filter((item) => !(item.kind === credential.kind && item.provider === credential.provider)),
      credential,
    ]);
    return credential;
  }, []);

  const removeCredential = useCallback(async (id: string) => {
    await api(`/api/credentials/${id}`, { method: "DELETE" });
    setCredentials((current) => current.filter((credential) => credential.id !== id));
  }, []);

  const validateCredential = useCallback(async (id: string) => {
    const { credential } = await api<{ credential: Credential }>(`/api/credentials/${id}/validate`, {
      method: "POST",
    });
    setCredentials((current) => current.map((item) => (item.id === id ? credential : item)));
    return credential;
  }, []);

  const deleteAccount = useCallback(async () => {
    await api("/api/account", { method: "DELETE" });
    setUser(null);
    setConversations([]);
    setCredentials([]);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      user,
      conversations,
      settings,
      credentials,
      ready,
      error,
      refresh,
      refreshConversation,
      createConversation,
      addMessage,
      updateMessage,
      deleteConversation,
      setConversationMode,
      updateSettings,
      addCredential,
      removeCredential,
      validateCredential,
      deleteAccount,
    }),
    [
      user,
      conversations,
      settings,
      credentials,
      ready,
      error,
      refresh,
      refreshConversation,
      createConversation,
      addMessage,
      updateMessage,
      deleteConversation,
      setConversationMode,
      updateSettings,
      addCredential,
      removeCredential,
      validateCredential,
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
