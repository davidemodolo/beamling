import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { answers, ask, composer, connectKeys, createConversation, sidebarItem, signIn, watchConsole, workingAnswer } from "./helpers";

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
  });
  expect(problems).toEqual([]);
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
  await expect(answer).toContainText("actual");
  await expect(answer).toContainText("est. (1 search)");
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
    data: { kind: "search", provider: "tavily", key: "test-tavily-key" },
  });
  expect(tavily.status()).toBe(201);

  await page.goto("/chat");
  await page.getByLabel("Search provider").selectOption("tavily");
  await ask(page, "Use Tavily for this answer");
  const answer = answers(page).last();
  await expect(answer).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answer.locator(".badge").filter({ hasText: "Tavily" })).toBeVisible();
  await expect(answer).toContainText("est. (1 search)");
  await page.reload();
  await expect(answers(page).last().locator(".badge").filter({ hasText: "Tavily" })).toBeVisible();
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
  await item.getByRole("button", { name: "Pin Pinned chat" }).click();

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
  await expect(answer.locator(".badge").filter({ hasText: "Stopped" }).or(answer.getByText("fixture answer"))).toBeVisible({
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
  await expect(answers(page).last().locator(".badge").filter({ hasText: "Stopped" })).toHaveCount(0);
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
  await expect(answer.locator(".badge").filter({ hasText: "Stopped" })).toBeVisible({ timeout: 15_000 });
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

for (const path of ["/", "/chat", "/onboarding", "/privacy", "/terms"]) {
  test(`${path} has no CSP violations or serious accessibility issues`, async ({ page }) => {
    const problems = watchConsole(page);
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
