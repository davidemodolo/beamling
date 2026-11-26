import { expect, test } from "@playwright/test";
import {
  answers,
  ask,
  connectKeys,
  sidebarItem,
  watchConsole,
} from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function attachImage(page: import("@playwright/test").Page, name = "photo.png") {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("list", { name: "Attachments" }).locator("img")).toHaveCount(1);
}

test("an image stays on the device and is sent again with a follow-up", async ({ page, browser }) => {
  const problems = watchConsole(page);
  await connectKeys(page.request);
  await page.goto("/");
  await attachImage(page);
  await ask(page, "What is in this photo?");
  await expect(answers(page).last()).toContainText("The model saw 1 image", { timeout: 20_000 });
  await expect(page.locator(".message-user .message-image img")).toHaveCount(1);

  // The server stores only that the question had an image: no bytes, no description.
  const id = page.url().split("/").at(-1)!;
  const { conversation } = await (await page.request.get(`/api/conversations/${id}`)).json();
  const [question] = conversation.messages;
  expect(question.attachments).toEqual([{ id: expect.any(String), kind: "image", mediaType: "image/webp" }]);

  // A follow-up re-sends the image from this device.
  await ask(page, "What colour is it?");
  await expect(answers(page).last()).toContainText("The model saw 1 image", { timeout: 20_000 });
  await page.reload();
  await expect(page.locator(".message-user .message-image img")).toHaveCount(1);

  // After 7 days the browser no longer uses the image: a placeholder, and the model does not get it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open("beamling-images");
        open.onsuccess = () => {
          const store = open.result.transaction("images", "readwrite").objectStore("images");
          const all = store.getAll();
          all.onsuccess = () => {
            for (const image of all.result) store.put({ ...image, savedAt: Date.now() - 8 * 86_400_000 });
            store.transaction.oncomplete = () => resolve();
          };
        };
      }),
  );
  await page.reload();
  await expect(page.locator(".message-image-missing")).toHaveCount(1);
  await ask(page, "Is it still there?");
  await expect(answers(page).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answers(page).last()).not.toContainText("The model saw");

  // Another browser never had a copy: a placeholder, and the model does not get the image.
  const other = await browser.newContext({ storageState: await page.context().storageState() });
  const otherPage = await other.newPage();
  await otherPage.goto(`/chat/${id}`);
  await expect(otherPage.locator(".message-image-missing")).toHaveCount(1);
  await ask(otherPage, "Where was it taken?");
  await expect(answers(otherPage).last()).toContainText("fixture answer", { timeout: 20_000 });
  await expect(answers(otherPage).last()).not.toContainText("The model saw");
  await other.close();
  expect(problems).toEqual([]);
});

test("a question can be only an image, and deleting the chat removes it from the device", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
  await attachImage(page);
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(answers(page).last()).toContainText("The model saw 1 image", { timeout: 20_000 });
  await expect(page.locator(".message-user .bubble")).toHaveCount(0);
  const item = sidebarItem(page, "Image question");
  await expect(item).toBeVisible();

  await item.hover();
  await item.getByRole("button", { name: "Delete Image question" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("beamling-images");
        open.onsuccess = () => {
          const count = open.result.transaction("images").objectStore("images").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(left).toBe(0);
});

test("a text file stays on the device, reaches the model and is stored only by name", async ({ page }) => {
  await connectKeys(page.request);
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "binary.txt", mimeType: "text/plain", buffer: Buffer.from([0x00, 0xff, 0xfe]) });
  await expect(page.getByText("This file is not plain text.")).toBeVisible();
  await input.setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\nThe launch moved to May.") });
  await expect(page.getByRole("list", { name: "Attachments" })).toContainText("notes.md");
  await ask(page, "Summarize my notes");
  await expect(answers(page).last()).toContainText("The model saw 1 file", { timeout: 20_000 });
  await expect(page.locator(".message-user .message-file")).toHaveText("notes.md");

  const id = page.url().split("/chat/")[1];
  const stored = (await (await page.request.get(`/api/conversations/${id}`)).json()).conversation;
  expect(stored.messages[0].attachments).toEqual([{ id: expect.any(String), kind: "text", name: "notes.md" }]);
  expect(JSON.stringify(stored)).not.toContain("The launch moved to May");

  // A follow-up re-sends the file from this device.
  await ask(page, "And the date?");
  await expect(answers(page).last()).toContainText("The model saw 1 file", { timeout: 20_000 });
});
