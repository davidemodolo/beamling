import { productionConfigErrors } from "./env";
import { cleanupExpired } from "./repo";

const CLEANUP_INTERVAL_MS = 15 * 60_000;

/** Refuses to boot a misconfigured production server, then schedules retention cleanup. */
export async function startServer(): Promise<void> {
  const errors = productionConfigErrors();
  if (errors.length) {
    console.error(`Beamling cannot start:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }

  const cleanup = () => cleanupExpired().catch((error) => console.warn("Cleanup failed", error));
  void cleanup();
  setInterval(cleanup, CLEANUP_INTERVAL_MS).unref();
}
