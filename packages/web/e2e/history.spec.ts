import { expect, test } from "@playwright/test";
import {
  answers,
  ask,
  connectKeys,
  createConversation,
  sidebarItem,
} from "./helpers";

test("the limits page shows the account's own usage and is linked from the sidebar", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
  await ask(page, "How big is this chat?");
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await page.getByRole("link", { name: "Limits" }).click();
  await expect(page).toHaveURL(/\/limits$/);
  await expect(page.getByRole("meter", { name: "Questions this hour" })).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByRole("meter", { name: "Chats" })).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Free up space" }).click();
  await expect(page.locator("#main").getByRole("link", { name: "How big is this chat?" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("limits.png"), fullPage: true });

  await page.getByRole("checkbox", { name: "Select How big is this chat?" }).check();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("meter", { name: "Chats" })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator("#main").getByText("No chats stored.")).toBeVisible();
});

test("sidebar chats can be pinned and searched", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
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

test("several chats can be selected and deleted at once, in a dialog that fits the window", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
  for (const question of ["First to delete", "Second to delete"]) {
    await page.goto("/");
    await ask(page, question);
    await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  }
  await page.getByRole("button", { name: "Select chats" }).click();
  await page.locator(".sidebar .history-check", { hasText: "First to delete" }).click();
  await page.locator(".sidebar .history-check", { hasText: "Second to delete" }).click();
  await expect(page.getByRole("toolbar", { name: "Selected chats" })).toContainText("2 selected");
  await page.getByRole("toolbar", { name: "Selected chats" }).getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete 2 chats" });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(24);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  const saved = page.waitForResponse((response) => response.url().endsWith("/api/conversations/delete") && response.ok());
  await dialog.getByRole("button", { name: "Delete" }).click();
  await saved;
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(sidebarItem(page, "First to delete")).toHaveCount(0);
  await expect(sidebarItem(page, "Second to delete")).toHaveCount(0);
});

test("older conversations load on demand", async ({ page }) => {
  await connectKeys(page.request);
  for (let i = 0; i < 51; i++) await createConversation(page.request);
  await page.goto("/");
  const items = page.locator(".sidebar .history-item");
  await expect(items).toHaveCount(50);
  await page.getByRole("button", { name: "Show older conversations" }).click();
  await expect(items).toHaveCount(51);
  await expect(page.getByRole("button", { name: "Show older conversations" })).toHaveCount(0);
});

test("the limits page fits a phone screen without horizontal scrolling", async ({ page }) => {
  await connectKeys(page.request);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await ask(page, "A question whose title is long enough to fill the row twice over");
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await page.goto("/limits");
  await page.getByRole("button", { name: "Free up space" }).click();
  await expect(page.getByRole("checkbox", { name: "Select all" })).toBeVisible();
  const overflow = await page.locator(".limits-scroll").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBe(0);
});
