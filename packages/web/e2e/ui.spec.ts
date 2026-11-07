import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  answers,
  ask,
  composer,
  connectKeys,
  createConversation,
  KILL_SWITCH_SECRET,
  sidebarItem,
  signIn,
  watchConsole,
  workingAnswer,
} from "./helpers";

test("onboarding connects keys and keeps the saved model and mode", async ({ page }) => {
  const problems = watchConsole(page);
  await signIn(page.request);
  await page.goto("/onboarding");
  await page.locator("#llm-key").fill("test-openrouter-key");
  await page.locator("#search-key").fill("test-brave-key");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/chat$/);

  // A returning user with saved preferences revisits onboarding.
  const saved = await page.request.patch("/api/settings", {
    data: { llmModel: "anthropic/claude-haiku-4.5", defaultMode: "deep" },
  });
  expect(saved.ok()).toBe(true);
  await page.goto("/onboarding");
  await expect(page.locator("#llm-model")).toHaveValue("anthropic/claude-haiku-4.5");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.settings).toEqual({
    llmModel: "anthropic/claude-haiku-4.5",
    defaultSearchProvider: "brave",
    defaultMode: "deep",
    analyticsOptOut: false,
  });
  expect(problems).toEqual([]);
});

test("onboarding with DeepSeek asks for one key that serves the model and search", async ({ page }) => {
  const problems = watchConsole(page);
  await signIn(page.request);
  await page.goto("/onboarding");
  await page.locator("#llm-model").selectOption("deepseek:deepseek-flash");
  await page.locator("#search-provider").selectOption("deepseek");
  await expect(page.getByText("Uses your DeepSeek key from above.")).toBeVisible();
  await expect(page.locator("#search-key")).toHaveCount(0);
  await expect(page.getByText(/DeepSeek is based in China/)).toBeVisible();
  await page.locator("#llm-key").fill("test-deepseek-key");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.credentials.map((credential: { provider: string; kind: string }) => [credential.provider, credential.kind])).toEqual([
    ["deepseek", "llm"],
  ]);
  expect(state.settings.llmModel).toBe("deepseek:deepseek-flash");
  expect(state.settings.defaultSearchProvider).toBe("deepseek");
  expect(problems).toEqual([]);
});

test("onboarding saves a key for a search provider without key limits", async ({ page }) => {
  await signIn(page.request);
  await page.goto("/onboarding");
  await page.locator("#search-provider").selectOption("tavily");
  await page.locator("#llm-key").fill("test-openrouter-key");
  await page.locator("#search-key").fill("test-tavily-key");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.credentials.map((credential: { provider: string }) => credential.provider).sort()).toEqual(["openrouter", "tavily"]);
});

test("a Quick answer streams with citations, cost breakdown and sources", async ({ page }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/chat");
  await ask(page, "What is Beamling?");
  await expect(workingAnswer(page)).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const answer = answers(page).last();
  await expect(answer).toContainText("fixture answer", { timeout: 20_000 });
  const meta = answer.locator(".answer-footer .meta");
  await expect(meta).toContainText("DeepSeek V4.1 Flash");
  await expect(meta.locator("[title*='1 search']")).toHaveCount(1);
  await expect(answer.locator("summary").filter({ hasText: "Searches" })).toBeVisible();
  await answer.locator("summary").filter({ hasText: "Searches" }).click();
  await expect(answer.locator(".trace-query")).toContainText("What is Beamling?");
  await answer.locator("summary").filter({ hasText: "Model reasoning" }).click();
  await expect(answer).toContainText("checked the three fixture sources");
  await expect(answer.locator("table")).toBeVisible();
  await expect(answer.locator("th")).toContainText(["Source", "Finding"]);
  await expect(workingAnswer(page)).toHaveCount(0);

  // The trace and reasoning survive a reload and start collapsed again.
  await page.reload();
  const reloaded = answers(page).last();
  await expect(reloaded.locator("summary").filter({ hasText: "Searches" })).toBeVisible();
  await expect(reloaded.locator("summary").filter({ hasText: "Model reasoning" })).toBeVisible();
  await expect(reloaded.locator("details.trace").first()).not.toHaveAttribute("open");
  await expect(page.locator(".message-user .bubble")).toHaveText(["What is Beamling?"]);
  await expect(sidebarItem(page, "What is Beamling?")).toBeVisible();
  expect(problems).toEqual([]);
});

test("a different search provider can be selected for an answer", async ({ page }) => {
  await connectKeys(page.request);
  const tavily = await page.request.post("/api/credentials", {
    data: { provider: "tavily", key: "test-tavily-key" },
  });
  expect(tavily.status()).toBe(201);

  await page.goto("/chat");
  await page.getByLabel("Search provider").selectOption("tavily");
  await ask(page, "Use Tavily for this answer");
  const answer = answers(page).last();
  await expect(answer).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answer.locator(".answer-footer .meta")).toContainText("Tavily");
  await expect(answer.locator(".answer-footer .meta [title*='1 search']")).toHaveCount(1);
  await page.reload();
  await expect(answers(page).last().locator(".answer-footer .meta")).toContainText("Tavily");
});

test("a search provider without a key is marked and asks for a key", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/chat");
  const picker = page.getByLabel("Search provider");
  await expect(picker.locator("option[value=exa]")).toHaveText("Exa · no key");
  await picker.selectOption("exa");
  await ask(page, "This should not be sent");
  await expect(answers(page).last()).toContainText("Key needed");
});

test("Deeper mode runs a research loop and persists the mode", async ({ page }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/chat");
  await page.getByRole("button", { name: "Deeper" }).click();
  await ask(page, "Research this question");
  const answer = answers(page).last();
  await expect(answer).toContainText("fixture answer", { timeout: 20_000 });
  await expect(page.locator(".topbar-title span")).toContainText("Deeper");
  await answer.locator("summary").filter({ hasText: "Searches" }).click();
  await expect(answer.locator(".trace-query")).toHaveCount(3);
  await expect(answer.locator(".trace-query").first()).toContainText("fixture deeper overview");
  await page.reload();
  await expect(page.locator(".topbar-title span")).toContainText("Deeper");
  expect(problems).toEqual([]);
});

test("sidebar chats can be pinned and searched", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/chat");
  await ask(page, "Pinned chat");
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });

  const item = sidebarItem(page, "Pinned chat");
  await item.hover();
  // The sidebar pins optimistically; wait for the server to store it before reloading,
  // or the reload can abort the request.
  const pinSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().includes("/api/conversations/") && response.ok(),
  );
  await item.getByRole("button", { name: "Pin Pinned chat" }).click();
  await pinSaved;

  const pinnedSection = page.locator('.sidebar section[aria-label="Pinned"]');
  await expect(pinnedSection).toContainText("Pinned chat");
  await page.reload();
  await expect(pinnedSection).toContainText("Pinned chat");

  const search = page.getByRole("searchbox", { name: "Search conversations" });
  await search.fill("Pinned");
  await expect(sidebarItem(page, "Pinned chat")).toBeVisible();
  await search.fill("no such chat");
  await expect(page.getByText(/No chats match/)).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(sidebarItem(page, "Pinned chat")).toBeVisible();

  const pinnedItem = pinnedSection.locator(".history-item", { hasText: "Pinned chat" });
  await pinnedItem.hover();
  await pinnedItem.getByRole("button", { name: "Unpin Pinned chat" }).click();
  await expect(page.locator('.sidebar section[aria-label="Pinned"]')).toHaveCount(0);
});

test("switching conversations mid-answer keeps each answer in its own conversation", async ({ page }) => {
  await connectKeys(page.request);
  const other = await createConversation(page.request);
  await page.goto("/chat");
  await ask(page, "Question for A");
  await expect(workingAnswer(page)).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const first = page.url();

  await page.goto(`/chat/${other}`);
  await expect(page.getByText("Ask anything.")).toBeVisible();
  await expect(workingAnswer(page)).toHaveCount(0);
  await expect(page.locator(".thread").getByText("Question for A")).toHaveCount(0);
  await composer(page).fill("Question for B");
  await expect(page.getByRole("button", { name: "Send question" })).toBeEnabled();

  // A full navigation disconnected A's stream, which the server stores as stopped (never blank).
  await page.goto(first);
  const answer = answers(page).last();
  await expect(answer).toBeVisible();
  await expect(answer.getByText("Generation stopped").or(answer.getByText("fixture answer"))).toBeVisible({
    timeout: 15_000,
  });
});

test("client-side navigation keeps the other answer streaming", async ({ page }) => {
  await connectKeys(page.request);
  await createConversation(page.request);
  await page.goto("/chat");
  await ask(page, "Keep streaming");
  await expect(workingAnswer(page)).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const first = new URL(page.url()).pathname;

  // The sidebar link to the other (empty) conversation is a client-side navigation.
  await sidebarItem(page, "New conversation").getByRole("link").click();
  await expect(page.getByText("Ask anything.")).toBeVisible();
  await expect(workingAnswer(page)).toHaveCount(0);

  await sidebarItem(page, "Keep streaming").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`${first}$`));
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answers(page).last().getByText("Generation stopped")).toHaveCount(0);
});

test("stop keeps the partial answer, and Ask again replaces it without repeating the question", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/chat");
  await ask(page, "Stop and retry me");
  await expect(page.locator(".message-assistant .assistant-body").last()).toContainText("This is a fixture answer", { timeout: 15_000 });
  await page.getByRole("button", { name: "Stop generating" }).click();

  const stopped = answers(page).last();
  await expect(stopped.getByText("Generation stopped")).toBeVisible();
  await expect(stopped).toContainText("The partial answer was kept.");

  await stopped.getByRole("button", { name: "Ask again" }).click();
  await expect(answers(page).last()).toContainText("third records a limitation", { timeout: 20_000 });
  await expect(page.locator(".message-user .bubble")).toHaveText(["Stop and retry me"]);
  await expect(answers(page)).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".message-user .bubble")).toHaveText(["Stop and retry me"]);
  await expect(answers(page)).toHaveCount(1);
});

test("a reload mid-answer shows the stored outcome, not a blank answer", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/chat");
  await ask(page, "Reload me");
  await expect(page.locator(".message-assistant .assistant-body").last()).toContainText("This is a fixture answer", { timeout: 15_000 });
  await page.reload();
  const answer = answers(page).last();
  await expect(answer.getByText("Generation stopped")).toBeVisible({ timeout: 15_000 });
  await expect(answer).toContainText("fixture");
});

test("a failure before anything is stored can be retried as a new question", async ({ page }) => {
  await signIn(page.request);
  await page.goto("/chat");
  await ask(page, "No keys yet");
  const failed = answers(page).last();
  await expect(failed).toContainText("Key needed");
  await connectKeys(page.request);
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(page.locator(".message-user .bubble")).toHaveText(["No keys yet"]);
  await expect(answers(page)).toHaveCount(1);
});

test("a new question clears an earlier failure that never reached the server", async ({ page }) => {
  await signIn(page.request);
  await page.goto("/chat");
  await ask(page, "Before keys");
  await expect(answers(page).last()).toContainText("Key needed");
  await connectKeys(page.request);
  await ask(page, "After keys");
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(page.locator(".message-user .bubble")).toHaveText(["After keys"]);
  await expect(answers(page)).toHaveCount(1);
});

test("deleting the conversation that is answering returns to a new question", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/chat");
  await ask(page, "Delete me while answering");
  await expect(workingAnswer(page)).toBeVisible();
  const item = sidebarItem(page, "Delete me while answering");
  await item.hover();
  await item.getByRole("button", { name: "Delete Delete me while answering" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("Ask anything.")).toBeVisible();
  await expect(sidebarItem(page, "Delete me while answering")).toHaveCount(0);
});

test("older conversations load on demand", async ({ page }) => {
  await connectKeys(page.request);
  for (let i = 0; i < 51; i++) await createConversation(page.request);
  await page.goto("/chat");
  const items = page.locator(".sidebar .history-item");
  await expect(items).toHaveCount(50);
  await page.getByRole("button", { name: "Show older conversations" }).click();
  await expect(items).toHaveCount(51);
  await expect(page.getByRole("button", { name: "Show older conversations" })).toHaveCount(0);
});

test("the generated license page and public legal footer resolve", async ({ page }) => {
  await page.goto("/licenses");
  await expect(page.getByRole("heading", { name: "Open-source licenses" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "MIT License" })).toBeVisible();
  await expect(page.locator(".license-item")).not.toHaveCount(0);
  expect(await page.locator(".license-item").count()).toBeGreaterThan(100);
  await expect(page.getByText("caniuse-lite", { exact: true })).toBeVisible();

  const hrefs = await page.locator(".legal-foot nav a").evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).getAttribute("href")).filter(Boolean),
  );
  expect([...new Set(hrefs)].sort()).toEqual(["/contact", "/cookies", "/licenses", "/privacy", "/security", "/status", "/subprocessors", "/terms"]);
  for (const href of hrefs) {
    const response = await page.request.get(href!);
    expect(response.ok(), href!).toBe(true);
  }

  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "Licenses" })).toHaveAttribute("href", "/licenses");
});

test("a new account accepts the terms before reaching the app", async ({ page }) => {
  await signIn(page.request, { pendingTerms: true });
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/welcome\?next=%2Fchat$/);
  const accept = page.getByRole("button", { name: "Accept and continue" });
  await expect(accept).toBeDisabled();
  await page.getByLabel(/at least 18 years old/).check();
  await expect(accept).toBeDisabled();
  await page.getByLabel(/I accept the Terms/).check();
  await accept.click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/chat$/);
});

test("/welcome has no CSP violations or serious accessibility issues", async ({ page }) => {
  const problems = watchConsole(page);
  await signIn(page.request, { pendingTerms: true });
  await page.goto("/welcome");
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious.map((violation) => violation.id)).toEqual([]);
});

for (const path of ["/", "/chat", "/onboarding", "/privacy", "/terms", "/licenses", "/cookies", "/subprocessors", "/security", "/status", "/contact"]) {
  test(`${path} has no CSP violations or serious accessibility issues`, async ({ page }) => {
    const problems = watchConsole(page);
    if (path === "/chat" || path === "/onboarding") await signIn(page.request);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
    expect(serious).toEqual([]);
  });
}

test("a scheduled shutdown is announced in the app, at sign-in and on the status page", async ({ page }) => {
  const operator = { Authorization: `Bearer ${KILL_SWITCH_SECRET}` };
  const shutdown = (data: object) => page.request.post("/api/internal/shutdown", { headers: operator, data });
  try {
    const noMail = await shutdown({ action: "schedule" });
    expect(noMail.status()).toBe(409);
    expect((await noMail.json()).error.code).toBe("MAIL_NOT_CONFIGURED");
    expect((await shutdown({ action: "schedule", days: 3, notify: false })).status()).toBe(400);
    const scheduled = await shutdown({ action: "schedule", notify: false });
    expect(scheduled.ok()).toBe(true);
    const days = (new Date((await scheduled.json()).shutdown.scheduledAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(14);

    await page.goto("/login");
    await expect(page.getByRole("status").filter({ hasText: "Beamling shuts down on" })).toBeVisible();
    await page.goto("/status");
    await expect(page.getByText(/Scheduled shutdown:/)).toBeVisible();

    await connectKeys(page.request);
    await page.goto("/chat");
    const banner = page.getByRole("alert").filter({ hasText: "Beamling shuts down on" });
    await expect(banner).toBeVisible();
    await expect(page.getByText("Chats are deleted 60 days after their last message.").first()).toBeVisible();
    await banner.getByRole("button", { name: "Download my data" }).click();
    await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/account/export");
  } finally {
    expect((await shutdown({ action: "cancel" })).ok()).toBe(true);
  }
  await page.goto("/chat");
  await expect(page.getByRole("alert").filter({ hasText: "Beamling shuts down on" })).toHaveCount(0);
});
