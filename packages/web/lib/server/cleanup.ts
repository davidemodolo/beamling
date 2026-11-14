import { processAnalyticsErasures } from "./analytics-erasure";
import { log } from "./log";
import { cleanupExpired } from "./repo";
import { processShutdown } from "./shutdown";

// Hourly: retention is measured in days, and a quiet instance should let Neon scale to zero.
export const CLEANUP_INTERVAL_MS = 60 * 60_000;

// Shared on globalThis: the startup timer and the route handlers are separate Next.js bundles.
const globalForCleanup = globalThis as unknown as { __beamlingCleanup?: { running?: Promise<void>; lastAt: number } };
const state = (globalForCleanup.__beamlingCleanup ??= { lastAt: 0 });

/** Retention housekeeping, PostHog erasures and a scheduled shutdown; one run at a time per process. */
export function runCleanup(): Promise<void> {
  state.running ??= Promise.all([
    cleanupExpired()
      .then(({ failures }) => {
        for (const failure of failures) log.error("Cleanup step failed", failure);
      })
      .catch((error) => log.error("Cleanup failed", error)),
    processAnalyticsErasures().catch((error) => log.error("PostHog erasure run failed", error)),
    processShutdown().catch((error) => log.error("Shutdown run failed", error)),
  ]).then(() => {
    state.lastAt = Date.now();
    state.running = undefined;
  });
  return state.running;
}

/**
 * Lets a request carry the cleanup: starts a run if one is due and waits (bounded) for the run in
 * flight. A platform that gives CPU only while a request is open (Cloud Run) starves the timer, so
 * the hourly readiness probe is what guarantees a complete run.
 */
export async function settleCleanup(maxWaitMs: number): Promise<void> {
  if (!state.running && Date.now() - state.lastAt >= CLEANUP_INTERVAL_MS) void runCleanup();
  if (!state.running) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([state.running, new Promise((resolve) => (timer = setTimeout(resolve, maxWaitMs)))]);
  clearTimeout(timer);
}
