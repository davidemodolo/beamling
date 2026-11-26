import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseSsl, databaseUrl } from "./env";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as {
  __beamlingPool?: Pool;
  __beamlingBaseDb?: Database;
  __beamlingDb?: Database;
  __beamlingAccountScope?: AsyncLocalStorage<{ userId: string; tx: Tx }>;
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
const baseDb = (globalForDb.__beamlingBaseDb ??= drizzle(pool, { schema }));
const accountScope = (globalForDb.__beamlingAccountScope ??= new AsyncLocalStorage());

/** Inside asUser() this is that account's transaction; outside, account tables return no rows. */
export const db: Database = (globalForDb.__beamlingDb ??= new Proxy(baseDb, {
  get(target, property) {
    const current = accountScope.getStore()?.tx ?? target;
    const value: unknown = Reflect.get(current, property, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
}));

/**
 * Runs `work` in one transaction with app.user_id set (pooler-safe), so RLS policies apply.
 * Nested calls for the same account reuse it. Keep `work` short: it holds a pool connection.
 */
export async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const current = accountScope.getStore();
  if (current) {
    if (current.userId !== userId) throw new Error("Nested account scope for a different account.");
    return work();
  }
  return baseDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return accountScope.run({ userId, tx }, work);
  });
}
