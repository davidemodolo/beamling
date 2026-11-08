"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError, errorMessage } from "../api";
import { clearImages, pruneImages } from "../image-store";
import type { AppState } from "../types";
import { AccountContext, useAccountSlice, type AccountValue } from "./account";
import { ConversationsContext, useConversationsSlice } from "./conversations";

export { useAccount } from "./account";
export { useConversations } from "./conversations";
export { withoutKey, type ThreadMessage } from "./threads";

/**
 * Client workspace state, in two contexts so a component re-renders only for the half it reads:
 * `useAccount()` (user, settings, keys) and `useConversations()` (list, threads, streaming
 * updates). This provider owns what spans both: the workspace load and account deletion.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Requests are numbered so a slow, older response never overwrites a newer one.
  const refreshSeq = useRef(0);
  // The slices reload the workspace after a failed optimistic update; set once refresh exists.
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const resync = useCallback(() => void refreshRef.current(), []);

  const account = useAccountSlice({ resync });
  const conversations = useConversationsSlice({ refreshSeq, resync });
  const { applyState: applyAccount, reset: resetAccount } = account;
  const { applyState: applyConversations, reset: resetConversations } = conversations;

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const state = await api<AppState>("/api/state");
      if (seq !== refreshSeq.current) return;
      applyAccount(state);
      applyConversations(state, seq);
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
  }, [applyAccount, applyConversations]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Load the workspace on mount. refresh only sets state after its request resolves; the rule
  // cannot see that through the slices' apply functions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void pruneImages();
  }, []);

  const deleteAccount = useCallback(async () => {
    await api("/api/account", { method: "DELETE" });
    await clearImages();
    resetAccount();
    resetConversations();
  }, [resetAccount, resetConversations]);

  const { user, settings, credentials } = account.state;
  const { updateSettings, addCredential, updateCredentialLimits, removeCredential, validateCredential, signOut } =
    account.actions;
  const accountValue = useMemo<AccountValue>(
    () => ({
      user,
      settings,
      credentials,
      ready,
      error,
      refresh,
      updateSettings,
      addCredential,
      updateCredentialLimits,
      removeCredential,
      validateCredential,
      signOut,
      deleteAccount,
    }),
    [
      user,
      settings,
      credentials,
      ready,
      error,
      refresh,
      updateSettings,
      addCredential,
      updateCredentialLimits,
      removeCredential,
      validateCredential,
      signOut,
      deleteAccount,
    ],
  );

  return (
    <AccountContext.Provider value={accountValue}>
      <ConversationsContext.Provider value={conversations.value}>{children}</ConversationsContext.Provider>
    </AccountContext.Provider>
  );
}
