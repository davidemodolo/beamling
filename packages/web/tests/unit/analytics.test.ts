import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYTICS_EVENT_PROPERTIES, analyticsDistinctId, buildAnalyticsPayload, createAnalytics } from "../../lib/server/analytics";
import { APP_VERSION } from "../../lib/version";
import { withEnv } from "../helpers";
import { configureUnitEnv } from "./helpers";

configureUnitEnv();

const ANALYTICS_CONFIG = {
  apiKey: "phc_test",
  host: "https://eu.i.posthog.com",
  appHost: "https://eu.posthog.com",
  salt: "analytics-test-salt-at-least-32-bytes",
  personalApiKey: "phx_test",
  projectId: "123",
};

test("analytics payloads contain allowlisted metadata only", () => {
  const userId = "private-user-id-0123456789";
  const payload = buildAnalyticsPayload(ANALYTICS_CONFIG, userId, "answer_completed", {
    mode: "quick",
    search_provider: "tavily",
    llm_model: "deepseek/deepseek-v4.1-flash",
    tokens_in: 12,
    tokens_out: 34,
    cost_usd: 0.001,
    search_cost_usd: 0.008,
    search_requests: 1,
    search_failures: 0,
    latency_ms: 500,
    uncited: false,
    no_sources: false,
    degraded: false,
    question: "must never leave the server",
    answer: "must never leave the server",
    source_url: "https://private.example",
    error_message: "must never leave the server",
  });

  assert.equal(payload.distinct_id, analyticsDistinctId(userId, ANALYTICS_CONFIG.salt));
  assert.match(payload.distinct_id, /^[0-9a-f]{32}$/);
  assert.notEqual(payload.distinct_id, userId);
  assert.equal(payload.properties.search_provider, "tavily");
  assert.equal(payload.properties.app_version, APP_VERSION);
  assert.equal(payload.properties.$geoip_disable, true);
  assert.equal(payload.properties.$ip, "0.0.0.0");
  assert.ok(!("question" in payload.properties));
  assert.ok(!("answer" in payload.properties));
  assert.ok(!("source_url" in payload.properties));
  assert.ok(!("error_message" in payload.properties));
  assert.ok(!JSON.stringify(payload).includes(userId));
});

test("analytics allowlist has no content or identity properties", () => {
  const forbidden = new Set(["question", "answer", "title", "source_url", "snippet", "key", "email", "ip", "error_message"]);
  for (const properties of Object.values(ANALYTICS_EVENT_PROPERTIES)) {
    for (const property of properties) assert.equal(forbidden.has(property), false, property);
  }
});

test("analytics is inert when disabled", async () => {
  let calls = 0;
  const client = createAnalytics({
    config: null,
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}");
    }) as typeof fetch,
  });
  client.capture("user", "account_created", {});
  await client.flush();
  assert.equal(calls, 0);
  assert.equal(client.distinctIdFor("user"), null);
  assert.equal(await client.deletePerson("anything"), false);
  assert.equal(calls, 0);
});

test("analytics drops every event of an account that opted out", async () => {
  const sent: string[] = [];
  const client = createAnalytics({
    config: ANALYTICS_CONFIG,
    isExcluded: async (userId) => {
      if (userId === "broken") throw new Error("database unavailable");
      return userId === "objector";
    },
    fetchImpl: (async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)).distinct_id);
      return new Response("{}");
    }) as typeof fetch,
  });
  client.capture("objector", "account_created", {});
  client.capture("broken", "account_created", {});
  client.capture("member", "account_created", {});
  await client.flush();
  assert.deepEqual(sent, [analyticsDistinctId("member", ANALYTICS_CONFIG.salt)]);
});

test("analytics deletion still works behind the kill switch", async () => {
  const requests: string[] = [];
  const client = createAnalytics({
    config: null,
    deletionConfig: ANALYTICS_CONFIG,
    fetchImpl: (async (input) => {
      requests.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  client.capture("user", "account_created", {});
  await client.flush();
  assert.equal(requests.length, 0);
  const distinctId = client.distinctIdFor("user");
  assert.equal(distinctId, analyticsDistinctId("user", ANALYTICS_CONFIG.salt));
  assert.equal(await client.deletePerson(distinctId as string), true);
  assert.deepEqual(requests, ["https://eu.posthog.com/api/projects/123/persons/bulk_delete/"]);
});

test("analytics reports an incomplete PostHog deletion as a failure", async () => {
  const client = createAnalytics({
    config: ANALYTICS_CONFIG,
    fetchImpl: (async () => Response.json({ deletion_errors: [{ id: "x" }] })) as typeof fetch,
  });
  assert.equal(await client.deletePerson("abc"), false);
});

test("the analytics client is shared across module copies", async () => {
  const { analytics } = await import("../../lib/server/analytics");
  const holder = globalThis as unknown as { __beamlingAnalytics?: unknown };
  assert.equal(holder.__beamlingAnalytics, analytics);
});

test("analytics erasure retries back off from five minutes to a day", async () => {
  const { erasureBackoffMs } = await import("../../lib/server/repo/analytics-erasures");
  assert.equal(erasureBackoffMs(0), 5 * 60_000);
  assert.equal(erasureBackoffMs(1), 10 * 60_000);
  assert.equal(erasureBackoffMs(50), 24 * 60 * 60_000);
});

test("analytics sends events and queues person deletion", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createAnalytics({
    config: ANALYTICS_CONFIG,
    fetchImpl: (async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  const userId = "analytics-delivery-user";
  client.capture(userId, "credential_added", { kind: "search", provider: "exa", status: "active" });
  await client.flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://eu.i.posthog.com/i/v0/e/");
  const body = JSON.parse(String(requests[0].init.body)) as {
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };
  assert.equal(body.event, "credential_added");
  assert.equal(body.distinct_id, analyticsDistinctId(userId, ANALYTICS_CONFIG.salt));
  assert.equal(body.properties.provider, "exa");
  assert.equal(body.properties.status, "active");
  assert.equal(body.properties.$geoip_disable, true);

  assert.equal(await client.deletePerson(client.distinctIdFor(userId) as string), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://eu.posthog.com/api/projects/123/persons/bulk_delete/");
  const headers = new Headers(requests[1].init.headers);
  assert.equal(headers.get("Authorization"), "Bearer phx_test");
  const deletion = JSON.parse(String(requests[1].init.body)) as {
    distinct_ids: string[];
    delete_events: boolean;
    delete_recordings: boolean;
  };
  assert.deepEqual(deletion.distinct_ids, [analyticsDistinctId(userId, ANALYTICS_CONFIG.salt)]);
  assert.equal(deletion.delete_events, true);
  assert.equal(deletion.delete_recordings, true);
});

test("analytics delivery failures never reject", async () => {
  const client = createAnalytics({
    config: ANALYTICS_CONFIG,
    fetchImpl: (async () => {
      throw new Error("network down");
    }) as typeof fetch,
  });
  client.capture("user", "account_created", {});
  await assert.doesNotReject(client.flush());
  assert.equal(await client.deletePerson("user"), false);
});

test("PostHog configuration is opt-in and derives the EU app host", async (t) => {
  const { posthogConfig } = await import("../../lib/server/env");
  withEnv(t, {
    ANALYTICS_ENABLED: undefined,
    POSTHOG_API_KEY: undefined,
    POSTHOG_PERSONAL_API_KEY: undefined,
    POSTHOG_PROJECT_ID: undefined,
    ANALYTICS_SALT: undefined,
    POSTHOG_HOST: undefined,
    POSTHOG_APP_HOST: undefined,
  });
  assert.equal(posthogConfig(), null);

  withEnv(t, {
    ANALYTICS_ENABLED: "true",
    POSTHOG_API_KEY: "phc_test",
    POSTHOG_PERSONAL_API_KEY: "phx_test",
    POSTHOG_PROJECT_ID: "123",
    ANALYTICS_SALT: "x".repeat(32),
    POSTHOG_HOST: undefined,
    POSTHOG_APP_HOST: undefined,
  });
  const config = posthogConfig();
  assert.equal(config?.host, "https://eu.i.posthog.com");
  assert.equal(config?.appHost, "https://eu.posthog.com");
  assert.equal(config?.apiKey, "phc_test");
});

test("PostHog hosts must be https, and localhost is refused in production", async (t) => {
  const { productionConfigErrors, posthogConfig } = await import("../../lib/server/env");
  withEnv(t, {
    ANALYTICS_ENABLED: "true",
    POSTHOG_API_KEY: "phc_test",
    POSTHOG_PERSONAL_API_KEY: "phx_test",
    POSTHOG_PROJECT_ID: "123",
    ANALYTICS_SALT: "x".repeat(32),
    POSTHOG_APP_HOST: undefined,
    NODE_ENV: "development",
    POSTHOG_HOST: "http://localhost:8010",
  });
  assert.equal(posthogConfig()?.host, "http://localhost:8010");

  withEnv(t, { POSTHOG_HOST: "http://posthog.example.com" });
  assert.equal(posthogConfig(), null);

  withEnv(t, { NODE_ENV: "production", POSTHOG_HOST: "http://localhost:8010" });
  assert.equal(posthogConfig(), null);
  assert.match(productionConfigErrors().join(" "), /POSTHOG_HOST must be an https origin outside localhost/);

  withEnv(t, { POSTHOG_HOST: "https://localhost" });
  assert.match(productionConfigErrors().join(" "), /POSTHOG_HOST must be an https origin outside localhost/);
});


test("PostHog deletion works behind the kill switch without the ingestion token", async (t) => {
  const { posthogConfig, posthogDeletionConfig } = await import("../../lib/server/env");
  withEnv(t, {
    ANALYTICS_ENABLED: "false",
    POSTHOG_API_KEY: undefined,
    POSTHOG_PERSONAL_API_KEY: "phx_delete",
    POSTHOG_PROJECT_ID: "123",
    ANALYTICS_SALT: "x".repeat(32),
    POSTHOG_HOST: undefined,
    POSTHOG_APP_HOST: undefined,
  });
  assert.equal(posthogConfig(), null);
  const deletion = posthogDeletionConfig();
  assert.ok(deletion);
  assert.equal(deletion.apiKey, "");
  assert.equal(deletion.appHost, "https://eu.posthog.com");
});
