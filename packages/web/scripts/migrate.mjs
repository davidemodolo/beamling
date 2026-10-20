import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(here, "../drizzle");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
try {
  await client.query(`create table if not exists beamling_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set(
    (await client.query("select filename from beamling_migrations")).rows.map((row) => row.filename),
  );
  const files = (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(resolve(folder, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await client.query("begin");
    try {
      for (const statement of statements) await client.query(statement);
      await client.query("insert into beamling_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  console.log("Migrations up to date.");
} finally {
  await client.end();
}
