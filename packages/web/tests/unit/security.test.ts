import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { ApiError } from "../../lib/server/http";
import { withEnv } from "../helpers";
import { configureUnitEnv, captureConsoleError, isApiError } from "./helpers";

configureUnitEnv();

test("the client IP comes only from the trusted proxy's X-Forwarded-For entry", async (t) => {
  const { clientIpKey } = await import("../../lib/server/http");
  const key = (forwardedFor?: string) => clientIpKey(new Headers(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}));

  withEnv(t, { TRUSTED_PROXY_HOPS: "1" });
  assert.equal(key("6.6.6.6, 10.0.0.1"), key("7.7.7.7, 10.0.0.1"), "client-written entries are ignored");
  assert.notEqual(key("6.6.6.6, 10.0.0.1"), key("6.6.6.6, 10.0.0.2"));

  withEnv(t, { TRUSTED_PROXY_HOPS: "2" });
  assert.equal(key("6.6.6.6, 1.2.3.4, 10.0.0.1"), key("7.7.7.7, 1.2.3.4, 10.0.0.9"));
  // Fewer entries than trusted proxies: the request skipped them, so it gets no address.
  assert.equal(key("6.6.6.6"), key("7.7.7.7"));
  assert.equal(key("6.6.6.6"), key());

  withEnv(t, { TRUSTED_PROXY_HOPS: "0" });
  assert.equal(key("6.6.6.6"), key("7.7.7.7"));

  withEnv(t, { TRUSTED_PROXY_HOPS: "1" });
  assert.equal(key("2001:db8:1:2:aaaa::1"), key("2001:db8:1:2::ffff"), "IPv6 clients are limited per /64");
  assert.equal(key("2001:db8:1:2:aaaa::1"), key("2001:DB8:0001:0002:0:0:0:9"));
  assert.notEqual(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"));
  assert.notEqual(key("2001:db8::1"), key("2001:db8:0:1::1"));
  assert.equal(key("::ffff:10.0.0.1"), key("10.0.0.1"), "an IPv4-mapped address is its IPv4 client");

  const before = key("6.6.6.6, 10.0.0.1");
  withEnv(t, { AUTH_SECRET: randomBytes(32).toString("base64") });
  assert.notEqual(key("6.6.6.6, 10.0.0.1"), before, "IP hashes are keyed, not reversible by enumeration");
});

test("each use of AUTH_SECRET gets its own derived key", async (t) => {
  const { authSecret, authSubkey } = await import("../../lib/server/env");
  const transaction = authSubkey("oidc-transaction");
  const ipHash = authSubkey("ip-hash");
  assert.equal(transaction.length, 32);
  assert.notDeepEqual(transaction, ipHash);
  assert.notDeepEqual(transaction, authSecret());
  assert.deepEqual(authSubkey("oidc-transaction"), transaction, "derivation is stable");
  withEnv(t, { AUTH_SECRET: randomBytes(32).toString("base64") });
  assert.notDeepEqual(authSubkey("oidc-transaction"), transaction, "a new secret derives new keys");
});

test("the test-only sign-in answers 404 when it is disabled", async (t) => {
  withEnv(t, { BEAMLING_TEST_AUTH: undefined, APP_URL: "https://beamling.example" });
  const { POST } = await import("../../app/api/auth/test-login/route");
  const response = await POST(new Request("http://localhost:3000/api/auth/test-login", { method: "POST" }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
  const crossOrigin = await POST(
    new Request("http://localhost:3000/api/auth/test-login", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
  );
  assert.equal(crossOrigin.status, 403);
});

test("same-origin checks trust only APP_URL, not proxy or host headers", async (t) => {
  const { assertSameOrigin } = await import("../../lib/server/http");
  withEnv(t, { APP_URL: "https://beamling.example" });
  const request = (origin: string | undefined, extra: Record<string, string> = {}) =>
    new Request("https://beamling.example/api/conversations", {
      method: "POST",
      headers: { ...(origin ? { Origin: origin } : {}), ...extra },
    });
  assert.doesNotThrow(() => assertSameOrigin(request(undefined)));
  assert.doesNotThrow(() => assertSameOrigin(request("https://beamling.example")));
  assert.throws(() => assertSameOrigin(request("http://beamling.example")), isApiError("INVALID_ORIGIN"));
  assert.throws(
    () => assertSameOrigin(request("https://evil.example", { "x-forwarded-host": "evil.example", Host: "evil.example" })),
    isApiError("INVALID_ORIGIN"),
    "a client-supplied forwarded host must not become the expected origin",
  );
  assert.throws(() => assertSameOrigin(request("not a URL")), isApiError("INVALID_ORIGIN"));
  // Fetch metadata rejects a cross-site request even when it carries no Origin header.
  assert.throws(() => assertSameOrigin(request(undefined, { "Sec-Fetch-Site": "cross-site" })), isApiError("INVALID_ORIGIN"));
  assert.throws(() => assertSameOrigin(request(undefined, { "Sec-Fetch-Site": "same-site" })), isApiError("INVALID_ORIGIN"));
  assert.doesNotThrow(() => assertSameOrigin(request("https://beamling.example", { "Sec-Fetch-Site": "same-origin" })));
});

test("the shutdown notice gives the date and how to export, in plain English text", async (t) => {
  withEnv(t, { APP_URL: "https://beamling.example", LEGAL_ENTITY: "Beamling Test S.r.l.", LEGAL_CONTACT_EMAIL: "privacy@example.test" });
  const { shutdownNotice } = await import("../../lib/server/shutdown");
  const notice = shutdownNotice({ scheduledAt: new Date("2026-11-05T10:00:00Z"), reason: "Hosting ends.", notify: true });
  assert.match(notice.subject, /5 November 2026 at 11:00 CET/);
  assert.match(notice.text, /Download my data/);
  assert.match(notice.text, /permanently deleted/);
  assert.match(notice.text, /Hosting ends\./);
  assert.match(notice.text, /privacy@example\.test/);
  assert.doesNotMatch(notice.text, /<[a-z]/i, "plain text, no HTML or tracking");
});

test("production refuses unsafe configuration", async (t) => {
  const { productionConfigErrors, productionConfigWarnings, secureCookies, sessionCookieName } = await import(
    "../../lib/server/env"
  );
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://beamling:secret@db.internal:5432/beamling",
    APP_URL: "https://beamling.example",
    OPENROUTER_APP_URL: undefined,
    NEXT_PUBLIC_APP_URL: undefined,
    TRUSTED_PROXY_HOPS: "1",
    COOKIE_SECURE: undefined,
    BEAMLING_FAKE_PROVIDERS: undefined,
    DATABASE_SSL: "true",
    AUTH_SECRET: randomBytes(32).toString("base64"),
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_ISSUER: "https://accounts.google.com",
    LEGAL_ENTITY: "Beamling Test S.r.l.",
    LEGAL_CONTACT_EMAIL: "privacy@example.test",
    LEGAL_ADDRESS: "Via Test 1, 00100 Roma, Italy",
    SMTP_URL: "smtps://mailer:secret@smtp.example.test",
    MAIL_FROM: "Beamling <noreply@example.test>",
    LEGAL_MAIL_PROVIDER: "Example Mail (Italy)",
    SIGNUP_MODE: "open",
    KMS_PROVIDER: "gcp",
    KMS_KEY_NAME: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    KILL_SWITCH_SECRET: "k".repeat(32),
    METRICS_SECRET: "m".repeat(32),
  };
  withEnv(t, base);
  assert.deepEqual(productionConfigErrors(), []);
  assert.deepEqual(productionConfigWarnings(), []);
  assert.equal(secureCookies(), true);
  assert.equal(sessionCookieName(), "__Host-beamling_session");

  const errorsWith = (values: Record<string, string | undefined>) => {
    const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
    Object.assign(process.env, values);
    for (const [k, v] of Object.entries(values)) if (v === undefined) delete process.env[k];
    try {
      return productionConfigErrors().join(" ");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  assert.match(
    errorsWith({ DATABASE_URL: "postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db", DATABASE_URL_DIRECT: undefined }),
    /DATABASE_URL_DIRECT is required/,
  );
  assert.equal(
    errorsWith({
      DATABASE_URL: "postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db",
      DATABASE_URL_DIRECT: "postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db",
    }),
    "",
  );
  assert.match(
    errorsWith({ DATABASE_URL_DIRECT: "postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db" }),
    /must be a direct connection/,
  );
  assert.match(errorsWith({ APP_URL: undefined }), /APP_URL is required/);
  assert.match(
    errorsWith({ APP_URL: undefined, OPENROUTER_APP_URL: "https://alias.example" }),
    /APP_URL is required/,
    "provider-specific aliases cannot replace APP_URL in production",
  );
  assert.match(errorsWith({ APP_URL: "http://beamling.example" }), /https/);
  assert.match(errorsWith({ APP_URL: "https://beamling.example/app" }), /origin only/);
  assert.match(
    errorsWith({ OIDC_REDIRECT_URI: "https://evil.example/api/auth/callback/google" }),
    /same origin as APP_URL/,
  );
  assert.match(errorsWith({ OIDC_REDIRECT_URI: "https://beamling.example/callback" }), /callback\/google/);
  assert.match(errorsWith({ TRUSTED_PROXY_HOPS: undefined }), /TRUSTED_PROXY_HOPS/);
  assert.match(errorsWith({ OIDC_ISSUER: "https://login.example.test" }), /Google-only alpha/);
  assert.match(errorsWith({ LEGAL_ENTITY: undefined }), /LEGAL_ENTITY/);
  assert.match(errorsWith({ LEGAL_CONTACT_EMAIL: undefined }), /LEGAL_CONTACT_EMAIL/);
  assert.match(errorsWith({ LEGAL_CONTACT_EMAIL: "not-an-email" }), /LEGAL_CONTACT_EMAIL/);
  assert.doesNotMatch(errorsWith({ LEGAL_ADDRESS: undefined }), /LEGAL_ADDRESS/);
  assert.match(errorsWith({ LEGAL_ADDRESS: undefined, LEGAL_VAT_ID: "IT00000000000" }), /LEGAL_ADDRESS/);
  assert.match(errorsWith({ SMTP_URL: "https://mail.example" }), /SMTP_URL/);
  assert.match(errorsWith({ MAIL_FROM: undefined }), /MAIL_FROM/);
  assert.match(errorsWith({ LEGAL_MAIL_PROVIDER: undefined }), /LEGAL_MAIL_PROVIDER/);
  assert.match(errorsWith({ LEGAL_LOG_RETENTION_DAYS: "thirty" }), /LEGAL_LOG_RETENTION_DAYS/);
  assert.match(errorsWith({ COOKIE_SECURE: "false" }), /COOKIE_SECURE/);
  assert.match(errorsWith({ BEAMLING_FAKE_PROVIDERS: "1" }), /BEAMLING_FAKE_PROVIDERS/);
  assert.match(errorsWith({ AUTH_SECRET: "short" }), /32 bytes/);
  assert.match(errorsWith({ KMS_PROVIDER: "env" }), /KMS_PROVIDER=env/);
  assert.match(errorsWith({ GCP_KMS_CREDENTIALS: "not-json" }), /GCP_KMS_CREDENTIALS must be a JSON/);
  assert.match(errorsWith({ GCP_KMS_CREDENTIALS: "{}" }), /GCP_KMS_CREDENTIALS must contain/);
  assert.equal(
    errorsWith({ GCP_KMS_CREDENTIALS: JSON.stringify({ client_email: "kms@example.test", private_key: "key" }) }),
    "",
  );
  assert.match(errorsWith({ ANALYTICS_ENABLED: "yes" }), /exactly true or false/);
  const analyticsErrors = errorsWith({ ANALYTICS_ENABLED: "true" });
  assert.match(analyticsErrors, /POSTHOG_API_KEY/);
  assert.match(analyticsErrors, /POSTHOG_PERSONAL_API_KEY/);
  assert.match(analyticsErrors, /POSTHOG_PROJECT_ID/);
  assert.match(analyticsErrors, /ANALYTICS_SALT/);
  assert.match(
    errorsWith({
      ANALYTICS_ENABLED: "true",
      POSTHOG_API_KEY: "phc_test",
      POSTHOG_PERSONAL_API_KEY: "phx_test",
      POSTHOG_PROJECT_ID: "not-a-number",
      ANALYTICS_SALT: "x".repeat(32),
      POSTHOG_HOST: "https://eu.i.posthog.com",
    }),
    /POSTHOG_PROJECT_ID must be numeric/,
  );
  assert.equal(
    errorsWith({
      ANALYTICS_ENABLED: "true",
      POSTHOG_API_KEY: "phc_test",
      POSTHOG_PERSONAL_API_KEY: "phx_test",
      POSTHOG_PROJECT_ID: "123",
      ANALYTICS_SALT: "x".repeat(32),
      POSTHOG_HOST: "https://eu.i.posthog.com",
    }),
    "",
  );
  // A local Docker run is allowed, without Secure cookies.
  assert.equal(errorsWith({ APP_URL: "http://localhost:3000", TRUSTED_PROXY_HOPS: undefined }), "");

  withEnv(t, {
    DATABASE_SSL: undefined,
    DATABASE_URL: "postgres://beamling:beamling@db.example.com/beamling",
    SMTP_URL: undefined,
  });
  const warnings = productionConfigWarnings().join(" ");
  assert.match(warnings, /DATABASE_SSL/);
  assert.match(warnings, /SMTP_URL/);
  assert.match(warnings, /default local password/);
});

test("request bodies are size-limited and stripped of control characters", async () => {
  const { MAX_BODY_BYTES, cleanText, parseBody, storableText } = await import("../../lib/server/http");
  const { z } = await import("zod");
  const schema = z.object({ question: z.string() });
  const big = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ question: "x".repeat(MAX_BODY_BYTES) }) });
  await assert.rejects(() => parseBody(big, schema), isApiError("PAYLOAD_TOO_LARGE"));
  const declared = new Request("http://localhost/api", {
    method: "POST",
    body: "{}",
    headers: { "content-length": String(MAX_BODY_BYTES + 1) },
  });
  await assert.rejects(() => parseBody(declared, schema), isApiError("PAYLOAD_TOO_LARGE"));
  const ok = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ question: "hi" }) });
  assert.deepEqual(await parseBody(ok, schema), { question: "hi" });

  assert.equal(cleanText("a\u0000b\u0007c\td\ne"), "abc\td\ne");
  assert.equal(storableText("a\u0000b\u0007"), "ab\u0007");
});

test("logs never include query parameters", async (t) => {
  const { log } = await import("../../lib/server/log");
  const lines = captureConsoleError(t);
  const cause = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" });
  const error = Object.assign(new Error("Failed query: insert into messages\nparams: secret question,token-hash"), {
    query: "insert into messages",
    params: ["secret question", "token-hash"],
    cause,
  });
  log.error("Unhandled API error", error);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /secret question|token-hash/);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.error.query, "insert into messages");
  assert.equal(entry.error.cause.code, "22021");
});

test("logs redact provider keys and response bodies", async (t) => {
  const { log } = await import("../../lib/server/log");
  const lines = captureConsoleError(t);
  const key = "sk-or-v1-abcdefghijklmnopqrstuvwxyz";
  const top = new Error(`Provider failed: responseBody: {"answer":"private model text"} Authorization: Bearer ${key}`);
  log.error("Provider error", top);
  const nested = Object.assign(new Error("APICallError"), {
    cause: new Error('JSON parsing failed: Text: data: {"answer":"private model text"}'),
  });
  log.error("Provider parse error", nested);
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join("\n"), /private model text|sk-or-v1-abcdefghijklmnopqrstuvwxyz/);
  assert.match(lines.join("\n"), /body omitted/);
});

test("only answers about the key change its stored status", async () => {
  const { credentialStatusFor } = await import("../../lib/server/providers/errors");
  const error = (code: string) => new ApiError(code, "m", 400, "brave");
  assert.equal(credentialStatusFor(error("CREDENTIAL_INVALID")), "invalid");
  assert.equal(credentialStatusFor(error("INSUFFICIENT_CREDITS")), "invalid");
  assert.equal(credentialStatusFor(error("BRAVE_PLAN_MISSING_SEARCH")), "invalid");
  assert.equal(credentialStatusFor(error("PROVIDER_RATE_LIMITED")), "rate_limited");
  assert.equal(credentialStatusFor(error("PROVIDER_UNAVAILABLE")), null);
  assert.equal(credentialStatusFor(new TypeError("fetch failed")), null);
});

test("signup allowlists match exact addresses and domain suffixes", async (t) => {
  const { signupEmailAllowed } = await import("../../lib/server/env");
  withEnv(t, {
    SIGNUP_ALLOWED_EMAILS: "Person@Example.org",
    SIGNUP_ALLOWED_EMAIL_DOMAINS: "opencitylabs.it,@example.test",
  });
  assert.equal(signupEmailAllowed("person@example.org"), true);
  assert.equal(signupEmailAllowed("anyone@team.opencitylabs.it"), true);
  assert.equal(signupEmailAllowed("anyone@example.test"), true);
  assert.equal(signupEmailAllowed("anyone@evil.test"), false);
  assert.equal(signupEmailAllowed("not-an-email"), false);
});
