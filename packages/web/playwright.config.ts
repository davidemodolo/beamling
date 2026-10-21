import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run a production build (`pnpm build` first) with fixture providers against a
// migrated, disposable database.
const PORT = Number(process.env.E2E_PORT ?? 3210);
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set E2E_DATABASE_URL (or DATABASE_URL) to a migrated test database.");

export default defineConfig({
  testDir: "e2e",
  // One server, one database: tests run one at a time so timing-sensitive flows stay deterministic.
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: databaseUrl,
      CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
      AUTH_SECRET: randomBytes(32).toString("base64"),
      OIDC_ISSUER: "https://accounts.google.com",
      OIDC_CLIENT_ID: "e2e-client",
      OIDC_CLIENT_SECRET: "e2e-secret",
      OIDC_REDIRECT_URI: `http://localhost:${PORT}/api/auth/callback/google`,
      KMS_PROVIDER: "env",
      APP_URL: `http://localhost:${PORT}`,
      BEAMLING_FAKE_PROVIDERS: "1",
      BEAMLING_TEST_AUTH: "1",
      // Slow enough to stop, switch away from, or reload during an answer.
      BEAMLING_FAKE_DELAY_MS: "80",
      BRAVE_MIN_INTERVAL_MS: "0",
    },
  },
});
