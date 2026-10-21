import { expect, test } from "@playwright/test";
import { connectKeys, createConversation, signIn } from "./helpers";

test("signed-out requests are refused; signing in creates one reusable session", async ({ request, playwright, baseURL }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  const build = await health.json();
  expect(build.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(build.commit).toBeTruthy();
  expect(build.builtAt).toBeTruthy();

  const anonymous = await playwright.request.newContext({ baseURL });
  const refused = await anonymous.get("/api/conversations");
  expect(refused.status()).toBe(401);
  expect((await refused.json()).error.code).toBe("UNAUTHENTICATED");
  await anonymous.dispose();

  const login = await signIn(request);
  expect(login.headers()["set-cookie"] ?? "").toMatch(/HttpOnly/i);
  const first = await request.get("/api/state");
  expect(first.ok()).toBe(true);
  const again = await request.get("/api/state");
  expect((await again.json()).user.id).toBe((await first.json()).user.id);
});

test("cross-origin mutations are rejected", async ({ request }) => {
  await signIn(request);
  const response = await request.post("/api/conversations", {
    data: { mode: "quick" },
    headers: { Origin: "https://evil.example" },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe("INVALID_ORIGIN");

  // APP_URL is the expected origin; a forged proxy host cannot make evil.example look same-origin.
  const spoofed = await request.post("/api/conversations", {
    data: { mode: "quick" },
    headers: { Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" },
  });
  expect(spoofed.status()).toBe(403);
  expect((await spoofed.json()).error.code).toBe("INVALID_ORIGIN");
});

test("oversized and malformed bodies are refused before they reach the database", async ({ request }) => {
  await connectKeys(request);
  const big = await request.post("/api/chat", { data: { question: "x".repeat(70_000), mode: "quick" } });
  expect(big.status()).toBe(413);
  const nul = await request.post("/api/chat", { data: { question: "\u0000\u0000", mode: "quick" } });
  expect(nul.status()).toBe(400);
  expect((await nul.json()).error.code).toBe("INVALID_INPUT");
  const both = await request.post("/api/chat", {
    data: { question: "q", retryOf: "00000000-0000-4000-8000-000000000000", conversationId: "00000000-0000-4000-8000-000000000000", mode: "quick" },
  });
  expect(both.status()).toBe(400);
});

test("authenticated responses are private and pages carry a nonce-based CSP", async ({ request }) => {
  await signIn(request);
  const state = await request.get("/api/state");
  expect(state.headers()["cache-control"]).toBe("private, no-store");
  expect(state.headers()["vary"]).toMatch(/Cookie/);
  expect(state.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");

  const page = await request.get("/chat");
  const csp = page.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(csp).toContain("'strict-dynamic'");
  const html = await page.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(page.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(page.headers()["x-permitted-cross-domain-policies"]).toBe("none");
});

test("the conversation list is paginated", async ({ request }) => {
  await connectKeys(request);
  for (let i = 0; i < 52; i++) await createConversation(request);
  const state = await (await request.get("/api/state")).json();
  expect(state.conversations).toHaveLength(50);
  expect(state.conversationCount).toBe(52);
  expect(state.nextCursor).toBeTruthy();
  const next = await (await request.get(`/api/conversations?cursor=${encodeURIComponent(state.nextCursor)}`)).json();
  expect(next.conversations).toHaveLength(2);
  expect(next.nextCursor).toBeNull();
  expect((await request.get("/api/conversations?cursor=garbage")).status()).toBe(400);
});

test("signing out everywhere ends the session and clears the cookie", async ({ request }) => {
  await signIn(request);
  const response = await request.post("/api/auth/logout?scope=all");
  expect(response.ok()).toBe(true);
  expect(response.headers()["set-cookie"]).toMatch(/Max-Age=0/i);
  expect((await request.get("/api/state")).status()).toBe(401);
});

test("deleting the account clears the session", async ({ request }) => {
  await connectKeys(request);
  const deleted = await request.delete("/api/account");
  expect(deleted.ok()).toBe(true);
  expect(deleted.headers()["set-cookie"]).toMatch(/Max-Age=0/i);
  expect((await request.get("/api/conversations")).status()).toBe(401);
});

test("Brave plan, expiry and budget are stored as user-declared limits", async ({ request }) => {
  await signIn(request);
  const missingPlan = await request.post("/api/credentials", {
    data: { kind: "search", provider: "brave", key: "test-brave-limits" },
  });
  expect(missingPlan.status()).toBe(400);

  const created = await request.post("/api/credentials", {
    data: {
      kind: "search",
      provider: "brave",
      key: "test-brave-limits",
      plan: "free",
      expiresOn: "2030-01-31",
      budgetUsd: 5,
      budgetPeriod: "month",
    },
  });
  expect(created.status()).toBe(201);
  const credential = (await created.json()).credential;
  expect(credential.plan).toBe("free");
  expect(credential.expiresOn).toBe("2030-01-31");
  expect(credential.budgetUsd).toBe(5);

  const patched = await request.patch(`/api/credentials/${credential.id}`, {
    data: { plan: "paid", budgetUsd: 10 },
  });
  expect(patched.ok()).toBe(true);
  const updated = (await patched.json()).credential;
  expect(updated.plan).toBe("paid");
  expect(updated.budgetUsd).toBe(10);
});

test("an Exa key can be saved without validation and checked later", async ({ request }) => {
  await signIn(request);
  // Fixture providers reject keys without the test- prefix, so a 201 proves no check ran.
  const saved = await request.post("/api/credentials", {
    data: { kind: "search", provider: "exa", key: "exa-not-checked-yet", validate: false },
  });
  expect(saved.status()).toBe(201);
  const credential = (await saved.json()).credential;
  expect(credential.status).toBe("unverified");
  expect(credential.lastValidatedAt).toBeUndefined();

  const checked = await request.post(`/api/credentials/${credential.id}/validate`);
  expect(checked.status()).toBe(400);
  const state = await (await request.get("/api/state")).json();
  const stored = state.credentials.find((item: { id: string }) => item.id === credential.id);
  expect(stored.status).toBe("invalid");
  expect(stored.lastValidatedAt).toBeTruthy();
});

test("the default search provider can be changed and invalid providers are rejected", async ({ request }) => {
  await signIn(request);
  const saved = await request.patch("/api/settings", { data: { defaultSearchProvider: "tavily" } });
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).settings.defaultSearchProvider).toBe("tavily");
  expect((await (await request.get("/api/state")).json()).settings.defaultSearchProvider).toBe("tavily");

  const invalid = await request.patch("/api/settings", { data: { defaultSearchProvider: "serper" } });
  expect(invalid.status()).toBe(400);
});
