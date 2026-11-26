import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  answers,
  ask,
  composer,
  connectKeys,
  createConversation,
  removeKeys,
  sidebarItem,
  signIn,
  watchConsole,
  workingAnswer,
} from "./helpers";

test("a Quick answer streams with citations, cost breakdown and sources", async ({ page }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/");
  await ask(page, "What is Beamling?");
  await expect(workingAnswer(page)).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const answer = answers(page).last();
  await expect(answer).toContainText("fixture answer", { timeout: 20_000 });
  const meta = answer.locator(".answer-footer .meta");
  await expect(meta).toContainText("Nemotron 3.5 Super");
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

  await page.goto("/");
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
  await page.goto("/");
  const picker = page.getByLabel("Search provider");
  await expect(picker.locator("option[value=exa]")).toHaveText("Exa · no key");
  await picker.selectOption("exa");
  await ask(page, "This should not be sent");
  await expect(answers(page).last()).toContainText("Key needed");
});

test("Deeper mode runs a research loop and persists the mode", async ({ page }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/");
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

test("switching conversations mid-answer keeps each answer in its own conversation", async ({ page }) => {
  await connectKeys(page.request);
  const other = await createConversation(page.request);
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await ask(page, "Reload me");
  await expect(page.locator(".message-assistant .assistant-body").last()).toContainText("This is a fixture answer", { timeout: 15_000 });
  await page.reload();
  const answer = answers(page).last();
  await expect(answer.getByText("Generation stopped")).toBeVisible({ timeout: 15_000 });
  await expect(answer).toContainText("fixture");
});

test("a failure before anything is stored can be retried as a new question", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
  await removeKeys(page.request);
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
  await connectKeys(page.request);
  await page.goto("/");
  await removeKeys(page.request);
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
  await page.goto("/");
  await ask(page, "Delete me while answering");
  await expect(workingAnswer(page)).toBeVisible();
  const item = sidebarItem(page, "Delete me while answering");
  await item.hover();
  await item.getByRole("button", { name: "Delete Delete me while answering" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Ask anything.")).toBeVisible();
  await expect(sidebarItem(page, "Delete me while answering")).toHaveCount(0);
});

test("the latest answer can be regenerated and its question edited, replacing the exchange", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
  await ask(page, "First wording of the question");
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });

  await answers(page).last().getByRole("button", { name: "Regenerate answer" }).click();
  await expect(workingAnswer(page)).toBeVisible();
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answers(page)).toHaveCount(1);
  await expect(page.locator(".message-user .bubble")).toHaveCount(1);

  await page.getByRole("button", { name: "Edit question" }).click();
  const editor = page.getByRole("textbox", { name: "Edit your question" });
  await editor.fill("Second wording of the question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answers(page)).toHaveCount(1);
  await expect(page.locator(".message-user .bubble")).toHaveText("Second wording of the question");

  // Stored: one exchange, with the edited text and a title that followed it.
  const id = page.url().split("/chat/")[1];
  const stored = (await (await page.request.get(`/api/conversations/${id}`)).json()).conversation;
  expect(stored.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);
  expect(stored.messages[0].content).toBe("Second wording of the question");
  expect(stored.title).toBe("Second wording of the question");
});

test("/search sends a typed question from the fragment, and only fills the composer for a link from another site", async ({ page }) => {
  await connectKeys(page.request);
  // Typed in the address bar: no initiator, so the question is sent.
  await page.goto("/search#q=typed%20from%20the%20address%20bar");
  await expect(page.locator(".message-user .bubble")).toHaveText("typed from the address bar", { timeout: 20_000 });
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });

  // Arriving from another site: the composer is filled and nothing is sent.
  const link = new URL("/search#q=from%20a%20link&mode=deep", page.url()).href;
  await page.route("http://another-site.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: `<a href="${link}">Ask Beamling</a>` }),
  );
  await page.goto("http://another-site.test/");
  await page.getByRole("link", { name: "Ask Beamling" }).click();
  await expect(composer(page)).toHaveValue("from a link");
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("button", { name: "Deep", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".message-user")).toHaveCount(0);

  const description = await page.request.get("/opensearch.xml");
  expect(description.headers()["content-type"]).toContain("application/opensearchdescription+xml");
  expect(await description.text()).toContain("/search#q={searchTerms}");
});

test("answers draw code with a copy button, charts, diagrams and a document in a side panel", async ({ page, context }) => {
  const problems = watchConsole(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectKeys(page.request);
  await page.goto("/");
  await ask(page, "Show visuals [fixture:visuals]");
  // The document opens beside the chat while it is written.
  const pane = page.locator(".document-pane");
  await expect(pane).toBeVisible({ timeout: 20_000 });
  const answer = answers(page).last();
  await expect(answer.locator(".answer-footer")).toBeVisible({ timeout: 20_000 });

  const code = answer.locator(".code-block").first();
  await expect(code.locator(".code-lang")).toHaveText("ts");
  await expect(code.locator(".hljs-keyword").first()).toHaveText("const");
  await code.getByRole("button", { name: "Copy code" }).click();
  await expect(code.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const answer: number = 42; // fixture");

  await expect(answer.locator(".chart figcaption")).toHaveText("Fixture chart");
  await expect(answer.locator(".chart svg rect")).toHaveCount(2);
  await expect(answer.locator(".diagram-svg svg")).toBeVisible();
  await expect(answer.locator(".diagram-svg script, .diagram-svg foreignObject")).toHaveCount(0);
  await expect(answer.locator(".code-note")).toHaveText("Could not draw this chart");

  // The panel is its own page to the right of the chat.
  const [chatBox, paneBox] = await Promise.all([page.locator(".thread-scroll").boundingBox(), pane.boundingBox()]);
  expect(paneBox!.x).toBeGreaterThan(chatBox!.x + chatBox!.width / 2);
  await expect(pane.locator(".document-title")).toHaveText("Fixture plan");
  // The repeated title heading is dropped; levels, nesting across blank lines and tasks are kept.
  const prose = pane.locator(".answer-prose");
  await expect(prose.locator("h1")).toHaveCount(0);
  await expect(prose.locator("h2")).toHaveText("Steps");
  await expect(prose.locator("h3")).toHaveText("Checks");
  await expect(prose.locator("ol > li")).toHaveCount(2);
  await expect(prose.locator("ol ul > li")).toHaveText("A detail under it");
  await expect(prose.locator(".task-item input")).toBeChecked();
  // Citations link to their source, and the cited sources are listed under the document.
  await expect(prose.locator(".citation").first()).toHaveAttribute("href", "https://example.org/beamling-overview");
  await expect(prose.locator(".citation").first()).toHaveAttribute("target", "_blank");
  await expect(pane.locator(".document-sources li")).toHaveCount(1);

  // Stored answers reopen the document from its card.
  await page.reload();
  const card = answers(page).last().locator(".document-card");
  await expect(card).toContainText("Fixture plan");
  await card.click();
  await expect(page.locator(".document-pane")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator(".document-pane").getByRole("button", { name: "Download as Markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("fixture-plan.md");
  const saved = await readFile((await file.path())!, "utf8");
  expect(saved.startsWith("# Fixture plan\n\nA plan built from the overview [1].")).toBe(true);
  expect(saved).toContain("[1]: <https://example.org/beamling-overview>");

  const results = await new AxeBuilder({ page }).include(".main-pane").analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(problems).toEqual([]);
});

test("answers show source pictures through Beamling, hide failed ones and keep them after reload", async ({ page, playwright, baseURL }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/");
  await ask(page, "Show pictures [fixture:images]");
  const answer = answers(page).last();
  await expect(answer.locator(".answer-footer")).toBeVisible({ timeout: 20_000 });

  // The first picture loads from the route; the second fails and is hidden entirely.
  const picture = answer.locator(".answer-image img");
  await expect(picture).toHaveCount(1);
  await expect(picture).toHaveAttribute("src", /^\/api\/sources\/[0-9a-f-]{36}\/image$/);
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(answer.locator(".answer-image-caption")).toContainText("Fixture picture");
  await expect(answer.getByText("Missing picture")).toHaveCount(0);

  await answer.getByRole("button", { name: "Enlarge picture: Fixture picture" }).click();
  const dialog = page.getByRole("dialog", { name: "Fixture picture" });
  await expect(dialog.getByRole("link", { name: "Open source page" })).toHaveAttribute("href", "https://example.org/beamling-overview");
  await dialog.getByRole("button", { name: "Close" }).click();

  // The route serves only the owner's sources that have a picture.
  const src = (await picture.getAttribute("src"))!;
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["cache-control"]).toBe("private, max-age=604800, immutable");
  expect(served.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  const id = page.url().split("/").at(-1)!;
  const conversation = (await (await page.request.get(`/api/conversations/${id}`)).json()).conversation;
  const sources = conversation.messages.at(-1).sources as { id: string; position: number; hasImage?: boolean; imageUrl?: string }[];
  expect(sources.every((source) => source.imageUrl === undefined)).toBe(true);
  const plain = sources.find((source) => !source.hasImage)!;
  expect((await page.request.get(`/api/sources/${plain.id}/image`)).status()).toBe(404);
  const other = await playwright.request.newContext({ baseURL });
  expect((await other.get(src)).status()).toBe(401);
  await signIn(other);
  expect((await other.get(src)).status()).toBe(404);
  await other.dispose();

  await page.reload();
  await expect(answers(page).last().locator(".answer-image img")).toHaveCount(1);
  expect(problems).toEqual([]);
});
