import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db";
import { hashToken, newSessionToken } from "./crypto";
import { SESSION_TTL_DAYS, secureCookies, sessionCookieName } from "./env";
import { ApiError } from "./http";
import { deleteSessions } from "./repo";
import { authSessions, users } from "./schema";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
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
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, hashToken(token)), gt(authSessions.expiresAt, new Date())))
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
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    avatarUrl: session.avatarUrl,
    createdAt: session.createdAt,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Sign in with Google to continue.", 401);
  }
  return user;
}

export async function createSession(userId: string): Promise<void> {
  const token = newSessionToken();
  await db.insert(authSessions).values({ userId, tokenHash: hashToken(token), expiresAt: expiry() });
  await setSessionCookie(token);
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
