import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db";
import { hashToken, newSessionToken } from "./crypto";
import { SESSION_MAX_AGE_DAYS, SESSION_TTL_DAYS, secureCookies, sessionCookieName } from "./env";
import { ApiError } from "./http";
import { deleteSessions } from "./repo";
import { authSessions, users } from "./schema";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  /** LEGAL_VERSION the account accepted, or null before the first acceptance. */
  termsVersion: string | null;
}

const DAY_MS = 86_400_000;

/** Idle expiry, capped at the absolute lifetime of a session created at `createdAt`. */
function expiry(createdAt: Date = new Date()): Date {
  return new Date(Math.min(Date.now() + SESSION_TTL_DAYS * DAY_MS, createdAt.getTime() + SESSION_MAX_AGE_DAYS * DAY_MS));
}

async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
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
      sessionCreatedAt: authSessions.createdAt,
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      termsVersion: users.termsVersion,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        gt(authSessions.expiresAt, new Date()),
        gt(authSessions.createdAt, new Date(Date.now() - SESSION_MAX_AGE_DAYS * DAY_MS)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Returns the session user, extending the session (at most once a day, never past its absolute
 * lifetime) while it is in use. The same daily renewal records account activity.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token) return null;
  const session = await readSession(token);
  if (!session) return null;

  const renewed = expiry(session.sessionCreatedAt);
  if (renewed.getTime() - session.expiresAt.getTime() > DAY_MS) {
    await db.update(authSessions).set({ expiresAt: renewed }).where(eq(authSessions.id, session.sessionId));
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, session.id));
    await setSessionCookie(token, renewed);
  }
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    avatarUrl: session.avatarUrl,
    createdAt: session.createdAt,
    termsVersion: session.termsVersion,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Sign in with Google to continue.", 401);
  }
  return user;
}

/** Starts a new session, revoking the one this browser held before so a sign-in never leaves it valid. */
export async function createSession(userId: string): Promise<void> {
  const store = await cookies();
  const previous = store.get(sessionCookieName())?.value;
  if (previous) await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(previous)));
  const token = newSessionToken();
  const expiresAt = expiry();
  await db.insert(authSessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  await setSessionCookie(token, expiresAt);
}

export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) {
    await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
  }
  await clearSessionCookie();
}

/** Signs the account out on every browser and device. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await deleteSessions(userId);
  await clearSessionCookie();
}
