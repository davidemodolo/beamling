import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { analyticsErasures } from "../schema";

/** How long a claimed row stays hidden from other instances while its request runs. */
const CLAIM_MS = 5 * 60_000;
/** Delay before the confirming pass, long enough for events that were in flight to be ingested. */
export const CONFIRM_DELAY_MS = 60 * 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;

export interface AnalyticsErasure {
  distinctId: string;
  passesLeft: number;
  attempts: number;
}

/**
 * Claims due rows so concurrent instances never run the same one. With `distinctId`, claims only
 * that row, which is how account deletion makes its first attempt straight away.
 */
export async function claimAnalyticsErasures(options: { distinctId?: string; limit?: number } = {}): Promise<AnalyticsErasure[]> {
  const only = options.distinctId ? sql`and distinct_id = ${options.distinctId}` : sql``;
  const result = await db.execute<{ distinct_id: string; passes_left: number; attempts: number }>(sql`
    update analytics_erasures
    set next_attempt_at = now() + ${`${CLAIM_MS} milliseconds`}::interval
    where distinct_id in (
      select distinct_id from analytics_erasures
      where next_attempt_at <= now() ${only}
      order by next_attempt_at
      limit ${options.limit ?? 20}
      for update skip locked
    )
    returning distinct_id, passes_left, attempts
  `);
  return result.rows.map((row) => ({ distinctId: row.distinct_id, passesLeft: row.passes_left, attempts: row.attempts }));
}

/** Exponential backoff from five minutes, capped at a day. Rows are never dropped on failure. */
export function erasureBackoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 5 * 60_000 * 2 ** Math.min(attempts, 20));
}

export async function recordAnalyticsErasure(row: AnalyticsErasure, ok: boolean): Promise<void> {
  const now = Date.now();
  if (ok && row.passesLeft <= 1) {
    await db.delete(analyticsErasures).where(eq(analyticsErasures.distinctId, row.distinctId));
    return;
  }
  await db
    .update(analyticsErasures)
    .set(
      ok
        ? { passesLeft: row.passesLeft - 1, attempts: 0, nextAttemptAt: new Date(now + CONFIRM_DELAY_MS) }
        : { attempts: row.attempts + 1, nextAttemptAt: new Date(now + erasureBackoffMs(row.attempts)) },
    )
    .where(eq(analyticsErasures.distinctId, row.distinctId));
}
