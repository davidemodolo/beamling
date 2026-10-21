import { eq, inArray, lt, lte } from "drizzle-orm";
import type { AppState } from "../../types";
import { db } from "../db";
import { authSessions, providerSlots, rateLimits, users } from "../schema";
import { forgetWorkspaceKey } from "../workspace-key";
import { countConversations, listConversationPage } from "./conversations";
import { listCredentials } from "./credentials";
import { interruptStaleAnswers } from "./messages";
import { ensureSettings } from "./settings";
import { iso } from "./shared";

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
  forgetWorkspaceKey(userId);
}

/**
 * Retention housekeeping: expired sessions and counters, abandoned answers. Accounts are not
 * deleted for inactivity because a Google sign-in can always return to them.
 */
export async function cleanupExpired(): Promise<{ failures: unknown[] }> {
  const now = new Date();
  const steps = [
    () => db.delete(authSessions).where(lte(authSessions.expiresAt, now)),
    () => db.delete(rateLimits).where(lte(rateLimits.expiresAt, now)),
    () => db.delete(providerSlots).where(lt(providerSlots.nextAt, new Date(now.getTime() - 60 * 60_000))),
    () => interruptStaleAnswers(),
  ];
  const results = await Promise.allSettled(steps.map((step) => step()));
  const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  return { failures };
}
