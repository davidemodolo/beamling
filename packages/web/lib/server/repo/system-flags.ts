import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { systemFlags } from "../schema";

export const ACCEPTING_NEW_STREAMS = "accepting_new_streams";

export interface SystemFlag {
  enabled: boolean;
  reason: string | null;
  updatedAt: Date | null;
}

const DEFAULT_ACCEPTING_NEW_STREAMS: SystemFlag = { enabled: true, reason: null, updatedAt: null };

function mapFlag(row: { enabled: boolean; reason: string | null; updatedAt: Date } | undefined): SystemFlag {
  return row ? { enabled: row.enabled, reason: row.reason, updatedAt: row.updatedAt } : DEFAULT_ACCEPTING_NEW_STREAMS;
}

/** A missing row means new streams are accepted, so a fresh database starts open. */
export async function acceptingNewStreams(): Promise<SystemFlag> {
  const [row] = await db
    .select({ enabled: systemFlags.enabled, reason: systemFlags.reason, updatedAt: systemFlags.updatedAt })
    .from(systemFlags)
    .where(eq(systemFlags.key, ACCEPTING_NEW_STREAMS))
    .limit(1);
  return mapFlag(row);
}

/** Changes the deployment-wide flag. Only the internal endpoint calls this. */
export async function setAcceptingNewStreams(enabled: boolean, reason?: string): Promise<SystemFlag> {
  const [row] = await db
    .insert(systemFlags)
    .values({ key: ACCEPTING_NEW_STREAMS, enabled, reason: reason ?? null })
    .onConflictDoUpdate({
      target: systemFlags.key,
      set: { enabled, reason: reason ?? null, updatedAt: new Date() },
    })
    .returning({ enabled: systemFlags.enabled, reason: systemFlags.reason, updatedAt: systemFlags.updatedAt });
  return mapFlag(row);
}

/** Counts answers currently streaming across every instance. */
export async function activeStreams(): Promise<number> {
  // Spans every account, so it reads through an owner function (row-level security).
  const result = await db.execute<{ total: number }>(sql`select total from beamling_streaming_answers(null)`);
  return Number(result.rows[0]?.total ?? 0);
}
