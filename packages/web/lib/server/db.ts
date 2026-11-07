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
    // statement_timeout, lock_timeout and idle_in_transaction_session_timeout are role defaults
    // set by the migrations, not startup parameters, so they also apply through a
    // transaction-mode pooler that would reject or drop startup parameters.
    ssl: databaseSsl(),
  });
}

// One pool per process: dev hot reloads and the separately bundled route handlers and
// instrumentation (which closes the pool on shutdown) must all share it.
export const pool = (globalForDb.__beamlingPool ??= createPool());
export const db = (globalForDb.__beamlingDb ??= drizzle(pool, { schema }));
