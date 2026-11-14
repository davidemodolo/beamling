import { pool } from "./db";
import { probeKms } from "./kms";

export interface Readiness {
  ok: boolean;
  database: "up" | "down";
  schema: "up" | "down";
  kms: "up" | "down";
}

// The endpoint is public: a healthy answer is kept for a minute so probing it cannot keep the
// database awake. A failing one is rechecked quickly, so recovery shows at once.
const READY_TTL_MS = 60_000;
const NOT_READY_TTL_MS = 5_000;
let cached: { at: number; value: Readiness } | undefined;
let inFlight: Promise<Readiness> | undefined;

async function checkReadiness(): Promise<Readiness> {
  const [database, schema, kms] = await Promise.allSettled([
    // The pool has a small connection budget; this is also why the probe is cached.
    pool.query("select 1"),
    pool.query("select count(*)::int as count from beamling_migrations"),
    probeKms(),
  ]);
  const hasMigrations =
    schema.status === "fulfilled" && Number((schema.value.rows[0] as { count?: number } | undefined)?.count ?? 0) > 0;
  return {
    ok: database.status === "fulfilled" && hasMigrations && kms.status === "fulfilled",
    database: database.status === "fulfilled" ? "up" : "down",
    schema: hasMigrations ? "up" : "down",
    kms: kms.status === "fulfilled" ? "up" : "down",
  };
}

export async function getReadiness(): Promise<Readiness> {
  if (cached && Date.now() - cached.at < (cached.value.ok ? READY_TTL_MS : NOT_READY_TTL_MS)) return cached.value;
  inFlight ??= checkReadiness()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
