import { expect, test } from "@playwright/test";
import { connectKeys, createConversation } from "./helpers";

test("a first visit gets a guest session; requests without one are refused", async ({ request, playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const refused = await anonymous.get("/api/conversations");
  expect(refused.status()).toBe(401);
  expect((await refused.json()).error.code).toBe("GUEST_SESSION_FAILED");
  await anonymous.dispose();

  const first = await request.get("/api/state");
  expect(first.ok()).toBe(true);
  const cookie = first.headers()["set-cookie"] ?? "";
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=lax/i);
  const again = await request.get("/api/state");
  expect((await again.json()).user.id).toBe((await first.json()).user.id);
});

test("another site cannot create guest workspaces", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get("/api/state", { headers: { "Sec-Fetch-Site": "cross-site" } });
  expect(response.status()).toBe(403);
  expect(response.headers()["set-cookie"]).toBeUndefined();
  await anonymous.dispose();
});

test("cross-origin mutations are rejected", async ({ request }) => {
  await request.get("/api/state");
  const response = await request.post("/api/conversations", {
    data: { mode: "quick" },
    headers: { Origin: "https://evil.example" },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
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

test("deleting the workspace clears the session", async ({ request }) => {
  await connectKeys(request);
  const deleted = await request.delete("/api/account");
  expect(deleted.ok()).toBe(true);
  expect(deleted.headers()["set-cookie"]).toMatch(/Max-Age=0/i);
  expect((await request.get("/api/conversations")).status()).toBe(401);
});
