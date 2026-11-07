import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(here, "../drizzle");
// Migrations hold a session-level advisory lock, so they need a direct connection: a
// transaction-mode pooler (Neon "-pooler", PgBouncer) would hand the session to other clients.
const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL (or DATABASE_URL_DIRECT) is required.");
  process.exit(1);
}
if (new URL(connectionString).hostname.includes("-pooler")) {
  console.error("Migrations need a direct connection. Set DATABASE_URL_DIRECT to the non-pooled connection string.");
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === "true"
    ? {
        rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
        ca: process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n") || (process.env.DATABASE_SSL_CA_FILE ? (await import("node:fs")).readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8") : undefined),
      }
    : undefined;
const client = new pg.Client({ connectionString, ssl });
// Serializes concurrent migration runs, e.g. several replicas deploying at once.
const LOCK_ID = 7_314_002_917;

// Request timeouts for the application, applied as role defaults so they also take effect
// through a pooler, which does not forward connection startup parameters. New sessions pick
// them up; this migration session runs without them.
const ROLE_DEFAULTS = {
  statement_timeout: "15s",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "30s",
};

await client.connect();
await client.query("set statement_timeout = 0; set lock_timeout = 0; set idle_in_transaction_session_timeout = 0");
await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
try {
  await client.query(`create table if not exists beamling_migrations (
    filename text primary key,
    checksum text,
    applied_at timestamptz not null default now()
  )`);
  // Existing deployments created the table before checksums existed; add the column in place.
  await client.query("alter table beamling_migrations add column if not exists checksum text");
  const applied = new Map(
    (await client.query("select filename, checksum from beamling_migrations")).rows.map((row) => [
      row.filename,
      row.checksum,
    ]),
  );
  const files = (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(folder, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (applied.has(file)) {
      const previous = applied.get(file);
      if (previous && previous !== checksum) {
        throw new Error(
          `Migration ${file} changed after it was applied. Add a new migration instead of editing an applied file.`,
        );
      }
      // Baseline rows applied before checksums were introduced. Future edits are detected.
      if (!previous) {
        await client.query("update beamling_migrations set checksum = $2 where filename = $1", [file, checksum]);
      }
      continue;
    }
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await client.query("begin");
    try {
      for (const statement of statements) await client.query(statement);
      await client.query("insert into beamling_migrations (filename, checksum) values ($1, $2)", [file, checksum]);
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  for (const [name, value] of Object.entries(ROLE_DEFAULTS)) {
    await client.query(`alter role current_user set ${name} = '${value}'`);
  }
  console.log("Migrations up to date.");
} finally {
  await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
  await client.end();
}
