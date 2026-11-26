import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/server/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://beamling:beamling@127.0.0.1:5433/beamling?sslmode=no-verify",
  },
  strict: true,
  verbose: true,
});
