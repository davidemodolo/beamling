import { and, eq, isNull, sql } from "drizzle-orm";
import { Client } from "pg";
import { db } from "../db";
import { databaseDirectUrl, databaseSsl } from "../env";
import { systemFlags, users } from "../schema";

export const SHUTDOWN = "shutdown";
// Only one instance at a time sends notices or deletes accounts (session-scoped advisory lock).
const SHUTDOWN_LOCK_ID = 7_314_002_919;

export interface Shutdown {
  /** When the service closes and every account is deleted. */
  scheduledAt: Date;
  /** Optional operator message included in the notice. */
  reason: string | null;
  /** Whether every account is emailed the notice. */
  notify: boolean;
}

/** The scheduled shutdown, or null while the service runs normally. */
export async function getShutdown(): Promise<Shutdown | null> {
  const [row] = await db
    .select({ scheduledAt: systemFlags.scheduledAt, reason: systemFlags.reason, notify: systemFlags.notify })
    .from(systemFlags)
    .where(and(eq(systemFlags.key, SHUTDOWN), eq(systemFlags.enabled, true)))
    .limit(1);
  return row?.scheduledAt ? { scheduledAt: row.scheduledAt, reason: row.reason, notify: row.notify } : null;
}

const PUBLIC_TTL_MS = 60_000;
// Pages and route handlers are bundled separately, so the cache lives on globalThis: a schedule or
// cancel in a route must clear what the pages read.
const publicCache = globalThis as { __beamlingPublicShutdown?: { at: number; value: Shutdown | null } };

/**
 * The scheduled shutdown for signed-out pages, read at most once a minute so their visitors cannot
 * keep the database awake. Decisions (sign-in, sign-up) use getShutdown().
 */
export async function getPublicShutdown(): Promise<Shutdown | null> {
  const cached = publicCache.__beamlingPublicShutdown;
  if (cached && Date.now() - cached.at < PUBLIC_TTL_MS) return cached.value;
  const value = await getShutdown();
  publicCache.__beamlingPublicShutdown = { at: Date.now(), value };
  return value;
}

/** Schedules the shutdown. Rescheduling resets delivery, so every account learns the new date. */
export async function scheduleShutdown(scheduledAt: Date, reason: string | null, notify: boolean): Promise<Shutdown> {
  await db.transaction(async (tx) => {
    await tx
      .insert(systemFlags)
      .values({ key: SHUTDOWN, enabled: true, reason, scheduledAt, notify })
      .onConflictDoUpdate({
        target: systemFlags.key,
        set: { enabled: true, reason, scheduledAt, notify, updatedAt: new Date() },
      });
    await tx.update(users).set({ shutdownNotifiedAt: null });
  });
  publicCache.__beamlingPublicShutdown = undefined;
  return { scheduledAt, reason, notify };
}

/**
 * Runs `work` only if no other instance is running shutdown work; returns false when skipped.
 * The lock lives on a dedicated direct connection (a transaction-mode pooler would hand the
 * session to other clients) and is released if the process dies.
 */
export async function withShutdownLock(work: () => Promise<void>): Promise<boolean> {
  const client = new Client({ connectionString: databaseDirectUrl(), ssl: databaseSsl(), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [SHUTDOWN_LOCK_ID]);
    if (!rows[0]?.locked) return false;
    try {
      await work();
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SHUTDOWN_LOCK_ID]);
    }
    return true;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function cancelShutdown(): Promise<void> {
  await db.delete(systemFlags).where(eq(systemFlags.key, SHUTDOWN));
  publicCache.__beamlingPublicShutdown = undefined;
}

/** Accounts that have not been sent the shutdown notice yet. */
export async function shutdownRecipients(limit: number): Promise<{ id: string; email: string }[]> {
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNull(users.shutdownNotifiedAt))
    .orderBy(users.createdAt)
    .limit(limit);
}

export async function markShutdownNotified(userId: string): Promise<void> {
  await db.update(users).set({ shutdownNotifiedAt: new Date() }).where(eq(users.id, userId));
}

export async function shutdownProgress(): Promise<{ accounts: number; notified: number }> {
  const [row] = await db
    .select({
      accounts: sql<number>`count(*)::int`,
      notified: sql<number>`count(${users.shutdownNotifiedAt})::int`,
    })
    .from(users);
  return { accounts: Number(row?.accounts ?? 0), notified: Number(row?.notified ?? 0) };
}

/** Accounts left to delete once the shutdown date has passed. */
export async function accountsToRetire(limit: number): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).limit(limit);
  return rows.map((row) => row.id);
}
