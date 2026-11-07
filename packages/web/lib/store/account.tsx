"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../api";
import { DEFAULT_SETTINGS } from "../data";
import type { AppState, BravePlan, BudgetPeriod, Credential, CredentialKind, Settings, User } from "../types";

export interface CredentialInput {
  kind: CredentialKind;
  provider: string;
  key: string;
  plan?: BravePlan;
  expiresOn?: string | null;
  budgetUsd?: number | null;
  budgetPeriod?: BudgetPeriod | null;
  validate?: boolean;
}

export type CredentialLimits = Pick<CredentialInput, "plan" | "expiresOn" | "budgetUsd" | "budgetPeriod">;

export interface AccountValue {
  user: User | null;
  settings: Settings;
  credentials: Credential[];
  /** The first workspace load has finished (successfully or not). */
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  addCredential: (input: CredentialInput) => Promise<Credential>;
  updateCredentialLimits: (id: string, patch: CredentialLimits) => Promise<Credential>;
  removeCredential: (id: string) => Promise<void>;
  validateCredential: (id: string) => Promise<Credential | undefined>;
  signOut: (everywhere?: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

export const AccountContext = createContext<AccountValue | null>(null);

export function useAccount(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside StoreProvider");
  return value;
}

/** The signed-in user, settings and saved keys. `resync` reloads the workspace after a failed update. */
export function useAccountSlice({ resync }: { resync: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applyState = useCallback((state: AppState) => {
    setUser(state.user);
    setCredentials(state.credentials);
    setSettings(state.settings);
  }, []);

  const reset = useCallback(() => {
    setUser(null);
    setCredentials([]);
    setSettings(DEFAULT_SETTINGS);
  }, []);

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
        resync();
        throw cause;
      }
    },
    [resync],
  );

  const addCredential = useCallback(async (input: CredentialInput) => {
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

  const replaceCredential = useCallback((credential: Credential) => {
    setCredentials((current) => current.map((item) => (item.id === credential.id ? credential : item)));
  }, []);

  const updateCredentialLimits = useCallback(
    async (id: string, patch: CredentialLimits) => {
      const { credential } = await api<{ credential: Credential }>(`/api/credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      replaceCredential(credential);
      return credential;
    },
    [replaceCredential],
  );

  const removeCredential = useCallback(async (id: string) => {
    await api(`/api/credentials/${id}`, { method: "DELETE" });
    setCredentials((current) => current.filter((credential) => credential.id !== id));
  }, []);

  const validateCredential = useCallback(
    async (id: string) => {
      try {
        const { credential } = await api<{ credential: Credential }>(`/api/credentials/${id}/validate`, {
          method: "POST",
          timeoutMs: 45_000,
        });
        replaceCredential(credential);
        return credential;
      } catch (cause) {
        // A failed check returns the status the server recorded (rejected, rate limited).
        const stored = cause instanceof ApiRequestError ? (cause.body?.credential as Credential | undefined) : undefined;
        if (stored) replaceCredential(stored);
        throw cause;
      }
    },
    [replaceCredential],
  );

  const signOut = useCallback(async (everywhere = false) => {
    await api(everywhere ? "/api/auth/logout?scope=all" : "/api/auth/logout", { method: "POST" });
    window.location.replace("/");
  }, []);

  return {
    state: { user, settings, credentials },
    actions: { updateSettings, addCredential, updateCredentialLimits, removeCredential, validateCredential, signOut },
    applyState,
    reset,
  };
}
