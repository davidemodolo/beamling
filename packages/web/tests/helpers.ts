import type { TestContext } from "node:test";

/** Replaces fetch for one test and returns the requested URLs. */
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

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Sets environment variables for one test (undefined deletes one) and restores them afterwards. */
export function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  t.after(() => apply(previous));
}
