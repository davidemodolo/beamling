import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseSsl, databaseUrl } from "./env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __beamlingPool?: Pool;
  __beamlingDb?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  return new Pool({
    connectionString: databaseUrl(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectionTimeoutMillis: 10_000,
    // A hung query or lock must fail the request instead of holding a stream and a connection open.
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 30_000,
    ssl: databaseSsl(),
  });
}

// One pool per process: dev hot reloads and the separately bundled route handlers and
// instrumentation (which closes the pool on shutdown) must all share it.
export const pool = (globalForDb.__beamlingPool ??= createPool());
export const db = (globalForDb.__beamlingDb ??= drizzle(pool, { schema }));
