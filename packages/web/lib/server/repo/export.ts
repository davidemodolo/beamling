import { asc, eq } from "drizzle-orm";
import { LEGAL_VERSION } from "../../legal";
import { db } from "../db";
import { authSessions, users } from "../schema";
import { exportConversations } from "./conversations";
import { listCredentials } from "./credentials";
import { ensureSettings } from "./settings";
import { iso } from "./shared";

/**
 * Everything Beamling stores about an account, decrypted, as one JSON document (Articles 15 and 20
 * GDPR). Provider keys are never included: only their metadata. Session tokens are stored as hashes
 * and are left out.
 */
export async function exportAccount(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const [settings, credentials, sessions, conversations] = await Promise.all([
    ensureSettings(userId),
    listCredentials(userId),
    db
      .select({ createdAt: authSessions.createdAt, expiresAt: authSessions.expiresAt })
      .from(authSessions)
      .where(eq(authSessions.userId, userId))
      .orderBy(asc(authSessions.createdAt)),
    exportConversations(userId),
  ]);
  return {
    format: "beamling-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      googleSubject: user.googleSub,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
      lastSeenAt: iso(user.lastSeenAt),
      termsVersion: user.termsVersion,
      termsAcceptedAt: user.termsAcceptedAt ? iso(user.termsAcceptedAt) : null,
      currentTermsVersion: LEGAL_VERSION,
    },
    settings,
    credentials,
    sessions: sessions.map((session) => ({ createdAt: iso(session.createdAt), expiresAt: iso(session.expiresAt) })),
    conversations,
  };
}
