import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { INACTIVE_ACCOUNT_MONTHS, UNACCEPTED_ACCOUNT_DAYS } from "../../legal";
import type { AppState } from "../../types";
import { analytics } from "../analytics";
import { audit } from "../audit";
import { db } from "../db";
import { analyticsErasures, authSessions, credentials, providerSlots, rateLimits, settings, users } from "../schema";
import { decryptCredential, providerSlotKey } from "../crypto";
import { forgetWorkspaceKey } from "../workspace-key";
import { forgetAnalyticsExclusion } from "./settings";
import {
  cleanupEmptyConversations,
  countConversations,
  deleteExpiredConversations,
  listConversationPage,
} from "./conversations";
import { listCredentials } from "./credentials";
import { interruptStaleAnswers } from "./messages";
import { ensureSettings } from "./settings";
import { iso } from "./shared";
import { questionLimitKeys } from "./usage";

export async function getState(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}): Promise<AppState> {
  const [page, conversationCount, credentialList, userSettings] = await Promise.all([
    listConversationPage(user.id),
    countConversations(user.id),
    listCredentials(user.id),
    ensureSettings(user.id),
  ]);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: iso(user.createdAt),
    },
    ...page,
    conversationCount,
    credentials: credentialList,
    settings: userSettings,
  };
}

/** Revokes every session of one account. */
export async function deleteSessions(userId: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
}

/** Records acceptance of the given terms version. */
export async function acceptTerms(userId: string, version: string): Promise<void> {
  const now = new Date();
  await db.update(users).set({ termsVersion: version, termsAcceptedAt: now, updatedAt: now }).where(eq(users.id, userId));
}

/**
 * Records the analytics objection. Opting out also queues erasure of the events already linked to the
 * account, in the same transaction, so an objection is never recorded without it. Opting back in
 * does not cancel a pending erasure: capture resumes once it has finished (see analyticsExcluded).
 */
export async function setAnalyticsOptOut(userId: string, optOut: boolean, distinctId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(settings).set({ analyticsOptOut: optOut, updatedAt: new Date() }).where(eq(settings.userId, userId));
    if (optOut && distinctId) {
      await tx
        .insert(analyticsErasures)
        .values({ distinctId })
        .onConflictDoUpdate({ target: analyticsErasures.distinctId, set: { passesLeft: 2, nextAttemptAt: new Date() } });
    }
  });
  forgetAnalyticsExclusion(userId);
}

/**
 * Deletes the account and, in the same transaction, queues its PostHog erasure. Atomicity matters:
 * a failed deletion must not erase the analytics of an account that still exists, and a successful
 * one must never lose the erasure if the process stops before the first PostHog request.
 */
export async function deleteAccount(userId: string, analyticsDistinctId?: string | null): Promise<void> {
  // Provider slots are keyed by the plaintext provider key; release them before the credentials cascade.
  const storedCredentials = await db.select().from(credentials).where(eq(credentials.userId, userId));
  const slotKeys: string[] = [];
  for (const row of storedCredentials) {
    if (row.kind !== "search" || row.provider !== "brave") continue;
    try {
      slotKeys.push(providerSlotKey("brave", await decryptCredential(userId, row)));
    } catch {
      // Age-based cleanup remains the fallback for an unreadable credential.
    }
  }
  await db.transaction(async (tx) => {
    if (analyticsDistinctId) {
      await tx
        .insert(analyticsErasures)
        .values({ distinctId: analyticsDistinctId })
        .onConflictDoUpdate({
          target: analyticsErasures.distinctId,
          set: { passesLeft: 2, nextAttemptAt: new Date() },
        });
    }
    if (slotKeys.length) await tx.delete(providerSlots).where(inArray(providerSlots.key, slotKeys));
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx
      .delete(rateLimits)
      .where(
        inArray(rateLimits.key, [
          ...Object.values(questionLimitKeys(userId)),
          `credentials:${userId}`,
          `conversations:${userId}`,
          `reads:${userId}`,
          `writes:${userId}`,
          `exports:${userId}`,
          `validations:${userId}`,
        ]),
      );
    await tx.delete(users).where(eq(users.id, userId));
  });
  forgetWorkspaceKey(userId);
}

/** Accounts deleted per cleanup run, so a backlog cannot hold the pool. */
const RETENTION_BATCH = 50;

/**
 * Storage limitation: deletes accounts unused for INACTIVE_ACCOUNT_MONTHS, and accounts created more
 * than UNACCEPTED_ACCOUNT_DAYS ago that never accepted the terms. Same path as a user deletion.
 */
export async function deleteRetiredAccounts(): Promise<number> {
  const rows = await db
    .select({ id: users.id, lastSeenAt: users.lastSeenAt })
    .from(users)
    .where(
      or(
        lt(users.lastSeenAt, sql`now() - make_interval(months => ${INACTIVE_ACCOUNT_MONTHS})`),
        and(isNull(users.termsAcceptedAt), lt(users.createdAt, sql`now() - make_interval(days => ${UNACCEPTED_ACCOUNT_DAYS})`)),
      ),
    )
    .limit(RETENTION_BATCH);
  for (const row of rows) {
    await deleteAccount(row.id, analytics.distinctIdFor(row.id));
    audit("inactive_account_deleted", { userId: row.id });
  }
  return rows.length;
}

/** Retention housekeeping: expired sessions and counters, abandoned answers, retired accounts. */
export async function cleanupExpired(): Promise<{ failures: unknown[] }> {
  const steps = [
    () => deleteRetiredAccounts(),
    () => deleteExpiredConversations(),
    () => db.delete(authSessions).where(sql`${authSessions.expiresAt} <= clock_timestamp()`),
    () => db.delete(rateLimits).where(sql`${rateLimits.expiresAt} <= clock_timestamp()`),
    () => db.delete(providerSlots).where(sql`${providerSlots.nextAt} < clock_timestamp() - interval '1 hour'`),
    () => cleanupEmptyConversations(),
    () => interruptStaleAnswers(),
  ];
  const results = await Promise.allSettled(steps.map((step) => step()));
  const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  return { failures };
}
