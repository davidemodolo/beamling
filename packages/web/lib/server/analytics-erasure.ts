import { analytics } from "./analytics";
import { log } from "./log";
import { claimAnalyticsErasures, enqueueAnalyticsErasure, recordAnalyticsErasure, type AnalyticsErasure } from "./repo";

/** Failed attempts after which every further failure is logged as an error, for alerting. */
const ALERT_AFTER_ATTEMPTS = 5;

async function attempt(row: AnalyticsErasure): Promise<void> {
  const ok = await analytics.deletePerson(row.distinctId);
  if (!ok) {
    const fields = { attempts: row.attempts + 1, distinctId: row.distinctId };
    if (row.attempts + 1 >= ALERT_AFTER_ATTEMPTS) log.error("PostHog erasure keeps failing", fields);
    else log.warn("PostHog erasure will be retried", fields);
  }
  await recordAnalyticsErasure(row, ok);
}

/**
 * Queues the account's PostHog erasure before its data is deleted, so a crash or a PostHog outage
 * never loses it. Returns the queued identity, or null when person deletion is not configured.
 */
export async function queueAnalyticsErasure(userId: string): Promise<string | null> {
  const distinctId = analytics.distinctIdFor(userId);
  if (distinctId) await enqueueAnalyticsErasure(distinctId);
  return distinctId;
}

/** First attempt, made right after the account is deleted. Failures stay queued for the cleanup job. */
export async function eraseAnalyticsNow(distinctId: string): Promise<void> {
  try {
    for (const row of await claimAnalyticsErasures({ distinctId, limit: 1 })) await attempt(row);
  } catch (error) {
    log.warn("PostHog erasure deferred", { error: error instanceof Error ? error.name : "UnknownError" });
  }
}

/** Runs due erasures: retries after failures and the confirming pass an hour after success. */
export async function processAnalyticsErasures(): Promise<void> {
  for (const row of await claimAnalyticsErasures()) await attempt(row);
}
