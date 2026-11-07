import { randomBytes } from "node:crypto";
import type { TestContext } from "node:test";
import { ApiError } from "../../lib/server/http";

/** Test keys and settings for unit tests; call once per file, after its imports. */
export function configureUnitEnv(): void {
  process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.AUTH_SECRET = randomBytes(32).toString("base64");
  process.env.KMS_PROVIDER = "env";
  // Request spacing reserves slots in the database; unit tests run without one.
  process.env.BRAVE_MIN_INTERVAL_MS = "0";
}

/** Collects console.error lines (where the structured logger writes) until the test ends. */
export function captureConsoleError(t: TestContext): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => lines.push(line);
  t.after(() => {
    console.error = original;
  });
  return lines;
}

export const isApiError = (code: string, provider?: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code && (provider === undefined || error.provider === provider);

