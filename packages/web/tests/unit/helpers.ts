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

/** Replaces fetch for one test. */
export function mockFetch(t: TestContext, handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

/** Sets environment variables for one test and restores them afterwards. */
export function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
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

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export const isApiError = (code: string, provider?: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code && (provider === undefined || error.provider === provider);

