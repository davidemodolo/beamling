import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { newCitations, sanitizeCitations, stripCitations } from "../lib/server/citations";
import { decryptCredential, encryptCredential } from "../lib/server/crypto";
import { ApiError } from "../lib/server/http";
import { searchBrave, validateBraveKey } from "../lib/server/providers/brave";
import { DEFAULT_LLM_MODEL, OPENROUTER_MODEL_IDS, isAllowedModel } from "../lib/providers";

process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");

test("DeepSeek V4.1 Flash is the default and is allowlisted", () => {
  assert.equal(DEFAULT_LLM_MODEL, "deepseek/deepseek-v4.1-flash");
  assert.equal(isAllowedModel(DEFAULT_LLM_MODEL), true);
  assert.equal(isAllowedModel("openrouter/auto"), false);
  assert.equal(OPENROUTER_MODEL_IDS.length, 5);
});

test("credential envelope encryption round-trips", () => {
  const userId = "6d1f2a8e-3fd5-4e42-9969-4c18f3da0f32";
  const encrypted = encryptCredential(userId, "llm", "openrouter", "sk-or-v1-secret-1234");
  assert.equal(encrypted.last4, "1234");
  assert.notEqual(encrypted.ciphertext, "sk-or-v1-secret-1234");
  const decrypted = decryptCredential(userId, {
    id: encrypted.id,
    kind: "llm",
    provider: "openrouter",
    wrappedDek: encrypted.wrappedDek,
    dekNonce: encrypted.dekNonce,
    dekTag: encrypted.dekTag,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    tag: encrypted.tag,
  });
  assert.equal(decrypted, "sk-or-v1-secret-1234");
});

test("credential envelope is bound to its owner", () => {
  const encrypted = encryptCredential("user-a", "search", "brave", "BSA-secret-9999");
  assert.throws(() =>
    decryptCredential("user-b", {
      id: encrypted.id,
      kind: "search",
      provider: "brave",
      wrappedDek: encrypted.wrappedDek,
      dekNonce: encrypted.dekNonce,
      dekTag: encrypted.dekTag,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      tag: encrypted.tag,
    }),
  );
});

test("Brave validates and searches only the base Web Search endpoint", async () => {
  const original = globalThis.fetch;
  const previousInterval = process.env.BRAVE_MIN_INTERVAL_MS;
  process.env.BRAVE_MIN_INTERVAL_MS = "0";
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Base search result",
              url: "https://example.org/base",
              description: "Standard <strong>search</strong> snippet.",
              extra_snippets: ["This must be ignored."],
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await validateBraveKey("BSA-web-plan-unique");
    const sources = await searchBrave("BSA-web-plan-unique", "test", { count: 2 });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => url.includes("/res/v1/web/search")));
    assert.ok(calls.every((url) => !url.includes("/llm/context")));
    assert.equal(sources.length, 1);
    assert.equal(sources[0].domain, "example.org");
    assert.equal(sources[0].snippet, "Standard search snippet.");
  } finally {
    globalThis.fetch = original;
    if (previousInterval === undefined) delete process.env.BRAVE_MIN_INTERVAL_MS;
    else process.env.BRAVE_MIN_INTERVAL_MS = previousInterval;
  }
});

test("Brave serializes requests per key", async () => {
  const original = globalThis.fetch;
  const previousInterval = process.env.BRAVE_MIN_INTERVAL_MS;
  process.env.BRAVE_MIN_INTERVAL_MS = "20";
  let active = 0;
  let peak = 0;
  globalThis.fetch = (async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return new Response(
      JSON.stringify({
        web: {
          results: [{ title: "Rate test", url: "https://example.org/rate", description: "Snippet." }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await Promise.all([
      searchBrave("BSA-rate-unique", "one", { count: 1 }),
      searchBrave("BSA-rate-unique", "two", { count: 1 }),
    ]);
    assert.equal(peak, 1);
  } finally {
    globalThis.fetch = original;
    if (previousInterval === undefined) delete process.env.BRAVE_MIN_INTERVAL_MS;
    else process.env.BRAVE_MIN_INTERVAL_MS = previousInterval;
  }
});

test("Brave explains keys with no search capability", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { detail: "The option is not included in the plan" } }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => validateBraveKey("BSA-no-search-unique"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "BRAVE_PLAN_MISSING_SEARCH" &&
        /Search plan/.test(error.message),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("citation parsing only reports valid new positions", () => {
  const seen = new Set<number>();
  assert.deepEqual(newCitations("A [1] and [3] and [9].", 3, seen), [1, 3]);
  assert.deepEqual(newCitations("Again [1] and [2].", 3, seen), [2]);
  assert.deepEqual([...seen], [1, 3, 2]);
});

test("citation sanitization removes invalid markers and preserves code", () => {
  assert.equal(sanitizeCitations("One [1], bad [4], code `[9]`.", 3), "One [1], bad , code `[9]`.");
  assert.equal(stripCitations("Answer [1][2]."), "Answer .");
});
