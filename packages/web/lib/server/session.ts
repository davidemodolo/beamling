import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "./db";
import { hashToken, newSessionToken } from "./crypto";
import { guestsPerHour, guestsPerIpPerHour, SESSION_TTL_DAYS, secureCookies, sessionCookieName } from "./env";
import { ApiError, clientIpKey } from "./http";
import { log } from "./log";
import { consumeRateLimit } from "./repo";
import { authSessions, settings, users } from "./schema";

export interface SessionUser {
  id: string;
  isGuest: boolean;
  createdAt: Date;
}

const DAY_MS = 86_400_000;

function expiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
}

async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0,
  });
}

async function readSession(token: string) {
  const [row] = await db
    .select({
      sessionId: authSessions.id,
      expiresAt: authSessions.expiresAt,
      id: users.id,
      isGuest: users.isGuest,
      createdAt: users.createdAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(eq(authSessions.tokenHash, hashToken(token)), gt(authSessions.expiresAt, new Date())),
    )
    .limit(1);
  return row ?? null;
}

/** Returns the session user, extending the session (at most once a day) while it is in use. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token) return null;
  const session = await readSession(token);
  if (!session) return null;

  const renewed = expiry();
  if (renewed.getTime() - session.expiresAt.getTime() > DAY_MS) {
    await db.update(authSessions).set({ expiresAt: renewed }).where(eq(authSessions.id, session.sessionId));
    await setSessionCookie(token);
  }
  return { id: session.id, isGuest: session.isGuest, createdAt: session.createdAt };
}

/** Every route except the workspace bootstrap requires an existing session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(
      "GUEST_SESSION_FAILED",
      "Your session expired. Reload the page to start a new workspace.",
      401,
    );
  }
  return user;
}

export async function getOrCreateUser(): Promise<SessionUser> {
  const existing = await getCurrentUser();
  if (existing) return existing;

  const requestHeaders = await headers();
  // Another site embedding /api/state must not mint workspaces (and use up the global cap).
  if (requestHeaders.get("sec-fetch-site") === "cross-site") {
    throw new ApiError("GUEST_SESSION_FAILED", "Open Beamling directly to start a workspace.", 403);
  }
  // The per-IP limit depends on proxy configuration; the global cap bounds growth regardless.
  await consumeRateLimit(`guest:${clientIpKey(requestHeaders)}`, guestsPerIpPerHour(), 3600);
  try {
    await consumeRateLimit("guest:all", guestsPerHour(), 3600);
  } catch (error) {
    if (error instanceof ApiError && error.code === "RATE_LIMITED") {
      log.warn("Global guest cap reached: new visitors are refused until the hour resets", { cap: guestsPerHour() });
    }
    throw error;
  }
  const token = newSessionToken();
  const user = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ isGuest: true })
      .returning({ id: users.id, isGuest: users.isGuest, createdAt: users.createdAt });
    await tx.insert(authSessions).values({ userId: created.id, tokenHash: hashToken(token), expiresAt: expiry() });
    await tx.insert(settings).values({ userId: created.id }).onConflictDoNothing();
    return created;
  });
  await setSessionCookie(token);
  return user;
}
