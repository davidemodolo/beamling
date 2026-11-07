import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../../lib/server/http";
import { searchBrave, validateBraveKey } from "../../lib/server/providers/brave";
import { exaError, searchExa, validateExaKey } from "../../lib/server/providers/exa";
import { searchTavily, tavilyError, validateTavilyKey } from "../../lib/server/providers/tavily";
import { DEFAULT_LLM_MODEL, MODELS, isAllowedModel } from "../../lib/provider-catalog";
import { modelHttpError, streamChat } from "../../lib/server/providers/llm";
import { openRouterModels } from "../../lib/server/providers/openrouter";
import { configureUnitEnv, mockFetch, jsonResponse, isApiError } from "./helpers";

configureUnitEnv();

const openRouterChat = (options: { model?: string; maxTokens?: number; signal?: AbortSignal } = {}) =>
  streamChat({
    provider: "openrouter",
    adapter: openRouterModels,
    key: "sk",
    apiModel: options.model ?? "m",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: options.maxTokens ?? 1,
    signal: options.signal,
  });

test("DeepSeek V4.1 Flash is the default and is allowlisted", () => {
  assert.equal(DEFAULT_LLM_MODEL, "deepseek/deepseek-v4.1-flash");
  assert.equal(isAllowedModel(DEFAULT_LLM_MODEL), true);
  assert.equal(isAllowedModel("openrouter/auto"), false);
  assert.equal(MODELS.filter((model) => model.provider === "openrouter").length, 5);
});

test("Brave validates and searches only the base Web Search endpoint", async (t) => {
  const calls = mockFetch(t, () =>
    jsonResponse({
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
  );
  await validateBraveKey("BSA-web-plan-unique");
  const sources = await searchBrave("BSA-web-plan-unique", "test", { count: 2 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.includes("/res/v1/web/search")));
  assert.ok(calls.every((url) => !url.includes("/llm/context")));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].domain, "example.org");
  assert.equal(sources[0].snippet, "Standard search snippet.");
});

test("Tavily validates with the free usage endpoint and searches with a minimal basic request", async (t) => {
  const bodies: Record<string, unknown>[] = [];
  const calls = mockFetch(t, (url, init) => {
    if (url === "https://api.tavily.com/usage") {
      assert.equal(init?.method, "GET");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer tvly-unique");
      return jsonResponse({ key: { usage: 10, limit: 1000 }, account: { current_plan: "Researcher" } });
    }
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return jsonResponse({
      results: [{
        title: "Tavily result",
        url: "https://example.org/tavily",
        content: "Tavily <strong>snippet</strong>.",
        published_date: "2026-10-01",
      }],
    });
  });
  await validateTavilyKey("tvly-unique");
  const sources = await searchTavily("tvly-unique", "test", { count: 2, freshnessDays: 7 });
  assert.deepEqual(calls, ["https://api.tavily.com/usage", "https://api.tavily.com/search"]);
  assert.equal(bodies[0].max_results, 2);
  assert.equal(bodies[0].search_depth, "basic");
  assert.equal(bodies[0].time_range, "week");
  assert.equal(bodies[0].include_raw_content, false);
  assert.equal(sources[0].snippet, "Tavily snippet.");
  assert.equal(sources[0].publishedAt, "2026-10-01");
});

test("Exa validates and searches highlights without page text", async (t) => {
  const bodies: Record<string, unknown>[] = [];
  const calls = mockFetch(t, (_url, init) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return jsonResponse({
      results: [{
        title: "Exa result",
        url: "https://example.org/exa",
        publishedDate: "2026-09-20T00:00:00.000Z",
        highlights: ["First <b>highlight</b>.", "Second highlight."],
      }],
    });
  });
  await validateExaKey("exa-unique");
  const sources = await searchExa("exa-unique", "test", { count: 3 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "https://api.exa.ai/search");
  assert.equal(bodies[0].numResults, 1);
  assert.equal(bodies[1].numResults, 3);
  assert.equal(bodies[1].type, "auto");
  assert.deepEqual(bodies[1].contents, { highlights: true });
  assert.equal(sources[0].snippet, "First highlight. Second highlight.");
  assert.equal(sources[0].publishedAt, "2026-09-20T00:00:00.000Z");
});

test("Tavily and Exa map provider statuses to stable codes", () => {
  const cases: [number, string][] = [
    [401, "CREDENTIAL_INVALID"],
    [432, "SEARCH_PLAN_MISSING"],
    [433, "QUOTA_EXCEEDED"],
    [402, "INSUFFICIENT_CREDITS"],
    [429, "PROVIDER_RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ];
  for (const [status, code] of cases) {
    assert.equal(tavilyError(status).code, code);
    if (status !== 432 && status !== 433) assert.equal(exaError(status).code, code);
  }
});

test("Tavily validation rejects an exhausted or unknown key without searching", async (t) => {
  const calls = mockFetch(t, (_url, init) =>
    new Headers(init?.headers).get("Authorization") === "Bearer tvly-spent"
      ? jsonResponse({ key: { usage: 1000, limit: 1000 } })
      : jsonResponse({ detail: { error: "Unauthorized" } }, 401),
  );
  await assert.rejects(validateTavilyKey("tvly-spent"), (error: ApiError) => error.code === "QUOTA_EXCEEDED");
  await assert.rejects(validateTavilyKey("tvly-wrong"), (error: ApiError) => error.code === "CREDENTIAL_INVALID");
  assert.deepEqual(calls, ["https://api.tavily.com/usage", "https://api.tavily.com/usage"]);
});

test("Tavily retries a 429 once and Exa surfaces a rejected request", async (t) => {
  let attempts = 0;
  mockFetch(t, () => {
    attempts += 1;
    return attempts === 1
      ? jsonResponse({}, 429, { "Retry-After": "0" })
      : jsonResponse({ results: [{ title: "Ok", url: "https://example.org/ok", content: "Snippet." }] });
  });
  const sources = await searchTavily("tvly-retry-unique", "q", { count: 1 });
  assert.equal(attempts, 2);
  assert.equal(sources.length, 1);

  mockFetch(t, () => jsonResponse({ error: "No credits" }, 402));
  await assert.rejects(() => searchExa("exa-unique", "q", { count: 1 }), isApiError("INSUFFICIENT_CREDITS", "exa"));
});

test("Brave explains keys with no search capability", async (t) => {
  mockFetch(t, () => jsonResponse({ error: { detail: "The option is not included in the plan" } }, 422));
  await assert.rejects(
    () => validateBraveKey("BSA-no-search-unique"),
    (error: unknown) => isApiError("BRAVE_PLAN_MISSING_SEARCH")(error) && /Search plan/.test((error as Error).message),
  );
});

test("Brave maps provider statuses to stable codes", async (t) => {
  const cases: [number, Record<string, unknown>, string][] = [
    [401, {}, "CREDENTIAL_INVALID"],
    [422, { error: { code: "SUBSCRIPTION_TOKEN_INVALID", detail: "The provided subscription token is invalid." } }, "CREDENTIAL_INVALID"],
    [402, {}, "INSUFFICIENT_CREDITS"],
    [503, {}, "PROVIDER_UNAVAILABLE"],
    [400, { error: { detail: "Bad parameter." } }, "PROVIDER_ERROR"],
  ];
  let current = cases[0];
  mockFetch(t, () => jsonResponse(current[1], current[0]));
  for (const entry of cases) {
    current = entry;
    await assert.rejects(() => searchBrave("BSA-status-unique", "q", { count: 1 }), isApiError(entry[2], "brave"));
  }
});

test("Brave retries a 429 once after Retry-After, then gives up", async (t) => {
  let attempts = 0;
  const started = Date.now();
  mockFetch(t, () => {
    attempts += 1;
    return attempts === 1
      ? jsonResponse({}, 429, { "Retry-After": "0.2" })
      : jsonResponse({ web: { results: [{ title: "Ok", url: "https://example.org/ok", description: "Snippet." }] } });
  });
  const sources = await searchBrave("BSA-retry-unique", "q", { count: 1 });
  assert.equal(attempts, 2);
  assert.equal(sources.length, 1);
  assert.ok(Date.now() - started >= 190, "waited for Retry-After");

  attempts = 0;
  mockFetch(t, () => {
    attempts += 1;
    return jsonResponse({}, 429, { "Retry-After": "0" });
  });
  await assert.rejects(() => searchBrave("BSA-retry-unique", "q", { count: 1 }), isApiError("PROVIDER_RATE_LIMITED"));
  assert.equal(attempts, 2);
});

test("Brave does not retry when the wait is long (quota exhausted)", async (t) => {
  let attempts = 0;
  mockFetch(t, () => {
    attempts += 1;
    return jsonResponse({}, 429, { "X-RateLimit-Reset": "1, 86400" });
  });
  // The per-second window resets in 1 s, so this one is retried.
  await assert.rejects(() => searchBrave("BSA-quota-unique", "q", { count: 1 }), isApiError("PROVIDER_RATE_LIMITED"));
  assert.equal(attempts, 2);

  attempts = 0;
  mockFetch(t, () => {
    attempts += 1;
    return jsonResponse({}, 429, { "Retry-After": "3600" });
  });
  await assert.rejects(() => searchBrave("BSA-quota-unique", "q", { count: 1 }), isApiError("PROVIDER_RATE_LIMITED"));
  assert.equal(attempts, 1);
});

test("a network failure is an outage, never a rejected key", async (t) => {
  mockFetch(t, () => {
    throw new TypeError("fetch failed");
  });
  const { validateOpenRouterKey } = await import("../../lib/server/providers/openrouter");
  await assert.rejects(() => validateBraveKey("BSA-offline-unique"), isApiError("PROVIDER_UNAVAILABLE", "brave"));
  await assert.rejects(() => validateOpenRouterKey("sk-or-offline"), isApiError("PROVIDER_UNAVAILABLE", "openrouter"));
  await assert.rejects(
    () => openRouterChat(),
    isApiError("PROVIDER_UNAVAILABLE", "openrouter"),
  );
});

test("a stop from the caller stays an abort", async (t) => {
  mockFetch(t, (_url, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new TypeError("fetch failed");
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => openRouterChat({ signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});

test("model providers map statuses and mid-stream errors to stable codes", async (t) => {
  const openRouterError = (status: number, message?: string) => modelHttpError("openrouter", status, message);
  assert.equal(openRouterError(401).code, "CREDENTIAL_INVALID");
  assert.equal(openRouterError(402).code, "INSUFFICIENT_CREDITS");
  assert.equal(openRouterError(404).code, "MODEL_NOT_FOUND");
  assert.equal(openRouterError(429).code, "PROVIDER_RATE_LIMITED");
  assert.equal(openRouterError(502).code, "PROVIDER_UNAVAILABLE");
  assert.equal(openRouterError(503).code, "PROVIDER_UNAVAILABLE");
  assert.equal(openRouterError(400, "This model's maximum context length is 8192 tokens").code, "CONTEXT_TOO_LARGE");
  assert.equal(openRouterError(400, "Invalid request").code, "PROVIDER_ERROR");
  // Provider auth failures must not reach the browser as 401, which means "no session" there.
  assert.equal(openRouterError(401).status, 400);

  const body = [
    'data: {"model":"routed/model","provider":"Upstream","choices":[{"delta":{"content":"Hi"}}]}',
    'data: {"error":{"code":502,"message":"Upstream failed"}}',
    "",
  ].join("\n\n");
  mockFetch(t, () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  await assert.rejects(
    () => openRouterChat(),
    isApiError("PROVIDER_UNAVAILABLE", "openrouter"),
  );
});

test("OpenRouter reports the resolved model, upstream provider and cost", async (t) => {
  const body = [
    'data: {"model":"deepseek/deepseek-v4.1-flash-0901","provider":"DeepInfra","choices":[{"delta":{"content":"Hello"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"cost":0.0001}}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  mockFetch(t, () => new Response(body, { status: 200 }));
  const result = await openRouterChat({ model: "deepseek/deepseek-v4.1-flash", maxTokens: 5 });
  assert.equal(result.content, "Hello");
  assert.equal(result.model, "deepseek/deepseek-v4.1-flash-0901");
  assert.equal(result.provider, "DeepInfra");
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 2, costUsd: 0.0001 });
});

test("Brave drops unsafe URLs and results without a snippet", async (t) => {
  mockFetch(t, () =>
    jsonResponse({
      web: {
        results: [
          { title: "Script", url: "javascript:alert(1)", description: "Looks fine." },
          { title: "Data", url: "data:text/html,hi", description: "Looks fine." },
          { title: "Malformed", url: "not a url", description: "Looks fine." },
          { title: "Credentials", url: "https://user:pass@example.org/private", description: "Looks fine." },
          { title: "Empty", url: "https://example.org/empty", description: "<b></b>" },
          { title: "Good", url: "https://example.org/good", description: "Real snippet." },
        ],
      },
    }),
  );
  const sources = await searchBrave("BSA-filter-unique", "test", { count: 5 });
  assert.deepEqual(
    sources.map((source) => [source.url, source.position]),
    [["https://example.org/good", 1]],
  );
});

test("malformed provider success bodies map to an outage, not a TypeError", async (t) => {
  const { searchBrave } = await import("../../lib/server/providers/brave");
  const { searchTavily } = await import("../../lib/server/providers/tavily");
  const { searchExa } = await import("../../lib/server/providers/exa");
  for (const search of [searchBrave, searchTavily, searchExa]) {
    mockFetch(t, () => new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    await assert.rejects(
      () => search("test-key", "q", { count: 1 }),
      (error: unknown) => error instanceof ApiError && error.code === "PROVIDER_UNAVAILABLE",
    );
  }
});

test("OpenRouter rejects a stream that ends without a completion marker", async (t) => {
  const body = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  mockFetch(t, () => new Response(body, { status: 200 }));
  await assert.rejects(
    () => openRouterChat(),
    isApiError("PROVIDER_UNAVAILABLE", "openrouter"),
  );
});
