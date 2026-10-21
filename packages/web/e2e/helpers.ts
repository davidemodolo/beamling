import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

export const KILL_SWITCH_SECRET = "e2e-kill-switch-secret-0000000000000000";
export const METRICS_SECRET = "e2e-metrics-secret-000000000000000000";

/** Signs in through the test-only auth route and creates fixture keys. */
export async function signIn(request: APIRequestContext): Promise<APIResponse> {
  const response = await request.post("/api/auth/test-login");
  expect(response.ok()).toBe(true);
  return response;
}

export async function connectKeys(request: APIRequestContext): Promise<void> {
  await signIn(request);
  expect((await request.get("/api/state")).ok()).toBe(true);
  for (const [kind, provider] of [
    ["llm", "openrouter"],
    ["search", "brave"],
  ]) {
    const response = await request.post("/api/credentials", {
      data: {
        kind,
        provider,
        key: `test-${provider}-key`,
        ...(provider === "brave" ? { plan: "free" } : {}),
      },
    });
    expect(response.status()).toBe(201);
  }
}

export async function createConversation(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/conversations", { data: { mode: "quick" } });
  expect(response.status()).toBe(201);
  return (await response.json()).conversation.id;
}

export function composer(page: Page) {
  return page.getByRole("textbox", { name: "Your question" });
}

export async function ask(page: Page, question: string): Promise<void> {
  await composer(page).fill(question);
  await page.getByRole("button", { name: "Send question" }).click();
}

export function answers(page: Page) {
  return page.getByRole("article", { name: "Beamling answer" });
}

export function workingAnswer(page: Page) {
  return page.locator("article.message-assistant .working");
}

/** Fails the test on any CSP violation or uncaught page error. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

/** The sidebar row for a conversation, by its exact title. */
export function sidebarItem(page: Page, title: string) {
  return page.locator(".sidebar .history-item", { has: page.getByRole("link", { name: title, exact: true }) });
}
