import { sql } from "drizzle-orm";
import { db } from "../db";
import { ApiError, clientIpKey } from "../http";
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

/** Provider key checks per account per day, and per client address per hour. */
const VALIDATIONS_PER_DAY = 50;
// Generous enough for an office or campus behind one address onboarding together.
const VALIDATIONS_PER_IP_PER_HOUR = 120;

/**
 * Budget for calls that check a key against its provider. It keeps the server from being used to
 * test lists of leaked keys: the cap is per account per day and per address, not only per hour.
 */
export async function consumeValidation(userId: string, headers: Headers): Promise<void> {
  await consumeRateLimit(`validations:${userId}`, VALIDATIONS_PER_DAY, 86_400);
  await consumeRateLimit(`validations-ip:${clientIpKey(headers)}`, VALIDATIONS_PER_IP_PER_HOUR, 3600);
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
