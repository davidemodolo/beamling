import { sql } from "drizzle-orm";
import { db } from "../db";
import { ApiError } from "../http";
import { providerSlots, rateLimits } from "../schema";

/** Fixed-window counter in a single atomic upsert, so concurrent requests cannot both pass the limit. */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const window = sql`make_interval(secs => ${windowSeconds})`;
  const expired = sql`${rateLimits.expiresAt} <= clock_timestamp()`;
  const [row] = await db
    .insert(rateLimits)
    .values({
      key,
      windowStart: sql`clock_timestamp()`,
      count: 1,
      expiresAt: sql`clock_timestamp() + ${window}`,
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then clock_timestamp() else ${rateLimits.windowStart} end`,
        expiresAt: sql`case when ${expired} then clock_timestamp() + ${window} else ${rateLimits.expiresAt} end`,
      },
    })
    .returning({ count: rateLimits.count });
  if (row.count > limit) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", 429);
  }
}

/**
 * Reserves the next request slot for a provider key, at least `intervalMs` after the previous
 * reservation from any instance. Returns how long the caller must wait for its slot, measured on
 * the database clock so instances with skewed clocks still agree.
 */
export async function reserveProviderSlot(key: string, intervalMs: number): Promise<number> {
  const interval = sql`make_interval(secs => ${intervalMs / 1000})`;
  const [row] = await db
    .insert(providerSlots)
    .values({ key, nextAt: sql`clock_timestamp() + ${interval}` })
    .onConflictDoUpdate({
      target: providerSlots.key,
      set: { nextAt: sql`greatest(${providerSlots.nextAt}, clock_timestamp()) + ${interval}` },
    })
    .returning({
      waitMs: sql<number>`greatest(0, extract(epoch from (${providerSlots.nextAt} - ${interval} - clock_timestamp())) * 1000)::float8`,
    });
  return Math.ceil(Number(row.waitMs));
}
