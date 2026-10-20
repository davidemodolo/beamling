import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db";
import { hashToken, newSessionToken } from "./crypto";
import { SESSION_COOKIE, SESSION_TTL_DAYS, secureCookies } from "./env";
import { authSessions, settings, users } from "./schema";

export interface SessionUser {
  id: string;
  isGuest: boolean;
  createdAt: Date;
}

function expiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
}

async function readUserFromToken(token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
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

async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readUserFromToken(token);
}

export async function getOrCreateUser(): Promise<SessionUser> {
  const existing = await getCurrentUser();
  if (existing) return existing;

  const token = newSessionToken();
  const expiresAt = expiry();
  const [user] = await db
    .insert(users)
    .values({ isGuest: true })
    .returning({ id: users.id, isGuest: users.isGuest, createdAt: users.createdAt });

  await db.insert(authSessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });
  await db.insert(settings).values({ userId: user.id }).onConflictDoNothing();

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });

  return user;
}
