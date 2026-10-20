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
    ssl: databaseSsl(),
  });
}

export const pool = globalForDb.__beamlingPool ?? createPool();
export const db = globalForDb.__beamlingDb ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__beamlingPool = pool;
  globalForDb.__beamlingDb = db;
}
