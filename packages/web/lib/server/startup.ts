import { abortAllChats } from "./active-chats";
import { analytics } from "./analytics";
import { CLEANUP_INTERVAL_MS, runCleanup } from "./cleanup";
import { pool } from "./db";
import { productionConfigErrors, productionConfigWarnings } from "./env";
import { beginShutdown } from "./shutdown-state";
import { log } from "./log";
import { interruptStaleAnswers } from "./repo";
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from "../version";

/** Time running answers get to store their outcome before the process exits. */
const SHUTDOWN_GRACE_MS = 8_000;

let shuttingDown = false;

/**
 * Stops running answers so their partial text is stored as interrupted, then closes the pool.
 * Next.js leaves signals to us when NEXT_MANUAL_SIG_HANDLE is set (the Docker image sets it).
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  beginShutdown();
  log.info("Shutting down", { signal });
  try {
    const messageIds = await abortAllChats(SHUTDOWN_GRACE_MS);
    // Anything that could not store its outcome in time is marked now, not after the stale-answer reaper.
    if (messageIds.length) await interruptStaleAnswers(messageIds);
  } catch (error) {
    log.error("Shutdown cleanup failed", error);
  }
  await analytics.flush();
  await pool.end().catch(() => {});
  process.exit(0);
}

/** Refuses to boot a misconfigured production server, then schedules retention cleanup. */
export async function startServer(): Promise<void> {
  const errors = productionConfigErrors();
  if (errors.length) {
    console.error(`Beamling cannot start:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  log.info("Beamling starting", { version: APP_VERSION, commit: GIT_COMMIT, builtAt: BUILD_TIME });
  for (const warning of productionConfigWarnings()) log.warn(warning);

  if (process.env.NEXT_MANUAL_SIG_HANDLE) {
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  }

  void runCleanup();
  setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS).unref();
}
