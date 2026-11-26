import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { AUTHOR_NAME, AUTHOR_URL } from "../lib/legal";
import {
  connectKeys,
  KILL_SWITCH_SECRET,
  signIn,
  watchConsole,
} from "./helpers";

test("the free setup connects OpenRouter and Brave, then setup is skipped", async ({ page }) => {
  const problems = watchConsole(page);
  await signIn(page.request);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Quick setup/ }).click();
  await expect(page.getByRole("heading", { name: "Connect OpenRouter" })).toBeVisible();
  await page.locator("#llm-key").fill("test-openrouter-key");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Brave Search" })).toBeVisible();
  await page.locator("#search-key").fill("test-brave-key");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/$/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.settings).toEqual({
    llmModel: "nvidia/nemotron-3.5-super-vl:free",
    defaultSearchProvider: "brave",
    defaultMode: "quick",
    analyticsOptOut: false,
    beamLight: false,
  });
  expect(state.credentials.find((credential: { provider: string }) => credential.provider === "brave").plan).toBe("free");

  // With both keys saved, setup is never shown again.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/$/);
  expect(problems).toEqual([]);
});

test("custom setup with DeepSeek asks for one key that serves the model and search", async ({ page }) => {
  const problems = watchConsole(page);
  await signIn(page.request);
  await page.goto("/onboarding");
  await page.getByRole("button", { name: /Use my own providers/ }).click();
  await page.locator("#llm-model").selectOption("deepseek:deepseek-flash");
  await expect(page.getByText(/DeepSeek is based in China/)).toBeVisible();
  await page.locator("#llm-key").fill("test-deepseek-key");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#search-provider").selectOption("deepseek");
  await expect(page.getByText("Uses your DeepSeek key.")).toBeVisible();
  await expect(page.locator("#search-key")).toHaveCount(0);
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/$/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.credentials.map((credential: { provider: string; kind: string }) => [credential.provider, credential.kind])).toEqual([
    ["deepseek", "llm"],
  ]);
  expect(state.settings.llmModel).toBe("deepseek:deepseek-flash");
  expect(state.settings.defaultSearchProvider).toBe("deepseek");
  expect(problems).toEqual([]);
});

test("a saved model key skips to the search step", async ({ page }) => {
  await signIn(page.request);
  const saved = await page.request.post("/api/credentials", { data: { provider: "openrouter", key: "test-openrouter-key" } });
  expect(saved.status()).toBe(201);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Choose your search provider" })).toBeVisible();
  await expect(page.locator("#llm-key")).toHaveCount(0);
  await page.locator("#search-provider").selectOption("tavily");
  await page.locator("#search-key").fill("test-tavily-key");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page).toHaveURL(/\/$/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.credentials.map((credential: { provider: string }) => credential.provider).sort()).toEqual(["openrouter", "tavily"]);
  expect(state.settings.defaultSearchProvider).toBe("tavily");
});

test("keys saved for other providers are used without asking for Brave", async ({ page }) => {
  await signIn(page.request);
  for (const provider of ["openrouter", "tavily"]) {
    const saved = await page.request.post("/api/credentials", { data: { provider, key: `test-${provider}-key` } });
    expect(saved.status()).toBe(201);
    // The defaults follow the first key saved for each kind.
    if (provider === "tavily") expect((await saved.json()).settings.defaultSearchProvider).toBe("tavily");
  }
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Search provider")).toHaveValue("tavily");
});

test("/ is the landing page signed out and the app signed in", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /Get started/ })).toHaveAttribute("href", "/login");
  await expect(nav.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Get in touch" })).toHaveAttribute("href", AUTHOR_URL);
  await expect(page.locator("footer").getByRole("link", { name: AUTHOR_NAME })).toHaveAttribute("href", AUTHOR_URL);
  await connectKeys(page.request);
  await page.goto("/");
  await expect(page.getByLabel("Search provider")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

test("the app is installable and shows an offline page without a connection", async ({ page, context }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", name: "Beamling" });
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.goto("/privacy").catch(() => {});
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  await context.setOffline(false);
});

test("setup offers sign-out and account deletion without any key", async ({ page }) => {
  await signIn(page.request);
  await page.goto("/onboarding");
  await page.getByText("Not continuing? Delete your account").click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get("/api/state")).status()).toBe(401);

  await signIn(page.request);
  await page.goto("/onboarding");
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get("/api/state")).status()).toBe(401);
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
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
  const accept = page.getByRole("button", { name: "Accept and continue" });
  await expect(accept).toBeDisabled();
  await page.getByLabel(/at least 18 years old/).check();
  await expect(accept).toBeDisabled();
  await page.getByLabel(/I accept the Terms/).check();
  await accept.click();
  // No keys yet: the app sends the new account on to setup.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("settings pick a model under its key and a search provider by card", async ({ page }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true");

  // OpenRouter is keyed, so its models can be picked; DeepSeek has no key, so its model cannot.
  await dialog.getByRole("radio", { name: "Claude Haiku 5.5" }).check();
  await expect(page.getByText("Claude Haiku 5.5 is now the default")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "DeepSeek V4.1 Flash · direct" })).toBeDisabled();
  expect((await (await page.request.get("/api/state")).json()).settings.llmModel).toBe("anthropic/claude-haiku-5.5");

  // Adding a DeepSeek key unlocks its model here and its search on the Search tab.
  const deepseek = dialog.getByRole("region", { name: "DeepSeek" });
  await deepseek.getByRole("button", { name: "Add key" }).click();
  await deepseek.getByLabel("DeepSeek API key").fill("test-deepseek-key");
  await deepseek.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("DeepSeek key saved")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "DeepSeek V4.1 Flash · direct" })).toBeEnabled();

  await dialog.getByRole("tab", { name: "Search" }).click();
  await expect(dialog.getByRole("radio", { name: /Brave Search/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /Tavily/ })).toBeDisabled();
  await dialog.getByRole("radio", { name: /DeepSeek/ }).check();
  await expect(page.getByText("DeepSeek is now the default")).toBeVisible();
  expect((await (await page.request.get("/api/state")).json()).settings.defaultSearchProvider).toBe("deepseek");

  const results = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious.map((violation) => violation.id)).toEqual([]);
  expect(problems).toEqual([]);
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

for (const path of ["/", "/app", "/limits", "/onboarding", "/privacy", "/terms", "/licenses", "/cookies", "/subprocessors", "/security", "/status", "/contact"]) {
  test(`${path} has no CSP violations or serious accessibility issues`, async ({ page }) => {
    const problems = watchConsole(page);
    if (path === "/app" || path === "/limits") await connectKeys(page.request);
    if (path === "/onboarding") await signIn(page.request);
    // "/app" is `/` signed in.
    await page.goto(path === "/app" ? "/" : path);
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
    await page.goto("/");
    const banner = page.getByRole("alert").filter({ hasText: "Beamling shuts down on" });
    await expect(banner).toBeVisible();
    await expect(page.getByText("Chats are deleted 60 days after their last question.").first()).toBeVisible();
    await banner.getByRole("button", { name: "Download my data" }).click();
    await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/account/export");
  } finally {
    expect((await shutdown({ action: "cancel" })).ok()).toBe(true);
  }
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Beamling shuts down on" })).toHaveCount(0);
});
