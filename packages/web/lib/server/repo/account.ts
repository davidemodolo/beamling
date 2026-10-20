import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { AppState } from "../../types";
import { db } from "../db";
import { authSessions, providerSlots, rateLimits, users } from "../schema";
import { countConversations, listConversationPage } from "./conversations";
import { listCredentials } from "./credentials";
import { interruptStaleAnswers } from "./messages";
import { ensureSettings } from "./settings";
import { iso } from "./shared";

/** Orphaned guests are deleted in batches so one cleanup run never holds long locks. */
const ORPHAN_BATCH = 200;
const ORPHAN_BATCHES_PER_RUN = 10;
// Guards against deleting a workspace whose session is being created in the same moment.
const ORPHAN_GRACE_MS = 60 * 60_000;

export async function getState(user: { id: string; isGuest: boolean; createdAt: Date }): Promise<AppState> {
  const [page, conversationCount, credentialList, userSettings] = await Promise.all([
    listConversationPage(user.id),
    countConversations(user.id),
    listCredentials(user.id),
    ensureSettings(user.id),
  ]);
  return {
    user: { id: user.id, isGuest: user.isGuest, createdAt: iso(user.createdAt) },
    ...page,
    conversationCount,
    credentials: credentialList,
    settings: userSettings,
  };
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx
      .delete(rateLimits)
      .where(
        inArray(rateLimits.key, [
          `chat:${userId}`,
          `credentials:${userId}`,
          `conversations:${userId}`,
          `reads:${userId}`,
        ]),
      );
    await tx.delete(users).where(eq(users.id, userId));
  });
}

/**
 * Deletes guest workspaces that no session can reach any more. A guest has no login, so once its
 * last session expires (30 days without use) nobody can open, export or delete that data.
 */
async function deleteOrphanedGuests(): Promise<number> {
  const createdBefore = new Date(Date.now() - ORPHAN_GRACE_MS);
  let deleted = 0;
  for (let batch = 0; batch < ORPHAN_BATCHES_PER_RUN; batch++) {
    const rows = await db
      .delete(users)
      .where(
        inArray(
          users.id,
          db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.isGuest, true),
                lt(users.createdAt, createdBefore),
                sql`not exists (select 1 from ${authSessions} where ${authSessions.userId} = ${users.id})`,
              ),
            )
            .limit(ORPHAN_BATCH),
        ),
      )
      .returning({ id: users.id });
    deleted += rows.length;
    if (rows.length < ORPHAN_BATCH) break;
  }
  return deleted;
}

/**
 * Retention housekeeping: expired sessions and counters, orphaned guests, abandoned answers. Each
 * step runs even if another fails, so one slow step cannot stall the rest.
 */
export async function cleanupExpired(): Promise<{ orphanedGuests: number; failures: unknown[] }> {
  const now = new Date();
  let orphanedGuests = 0;
  const steps = [
    async () => {
      await db.delete(authSessions).where(lte(authSessions.expiresAt, now));
      // Runs after the session sweep, so workspaces whose last session just expired go in the same run.
      orphanedGuests = await deleteOrphanedGuests();
    },
    () => db.delete(rateLimits).where(lte(rateLimits.expiresAt, now)),
    () => db.delete(providerSlots).where(lt(providerSlots.nextAt, new Date(now.getTime() - 60 * 60_000))),
    () => interruptStaleAnswers(),
  ];
  const results = await Promise.allSettled(steps.map((step) => step()));
  const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  return { orphanedGuests, failures };
}
