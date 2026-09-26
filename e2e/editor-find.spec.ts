// 2026-09-26 (Round Three): typing in "Find in this file" moved the editor's
// selection to the match, but a selection only paints while the editor has
// focus — and focus stays in the find box — so nothing on the page showed what
// matched. Every match is now marked, and the current one more strongly.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

async function openFind(page: Page) {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Find in this file");
  await page.locator(".prow", { hasText: "Find in this file" }).first().click();
  const input = page.getByRole("searchbox", { name: "Find text" });
  await expect(input).toBeFocused();
  return input;
}

test("find marks every match on the page and follows the current one", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("Find me\n\nalpha one, beta, Alpha two, gamma, ALPHA three");

  const input = await openFind(page);
  await input.fill("alpha");

  const marks = page.locator(".cm-content .cm-find-match");
  const current = page.locator(".cm-content .cm-find-current");
  await expect(marks).toHaveCount(3);
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("alpha");
  await expect(page.locator(".editor-find-count")).toHaveText("1/3");

  await page.getByRole("button", { name: "Next match" }).click();
  await expect(current).toHaveText("Alpha");
  await expect(page.locator(".editor-find-count")).toHaveText("2/3");

  // the marks are paint, not text: the note is unchanged and closing clears them
  await page.getByRole("button", { name: "Close find" }).click();
  await expect(marks).toHaveCount(0);
  await expect(page.locator(".cm-content").last()).toContainText("ALPHA three");
});

test("find marks follow edits and clear when the query empties", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("Edit me\n\nkiwi and kiwi");

  const input = await openFind(page);
  await input.fill("kiwi");
  const marks = page.locator(".cm-content .cm-find-match");
  await expect(marks).toHaveCount(2);

  await input.fill("");
  await expect(marks).toHaveCount(0);
  await expect(page.locator(".editor-find-count")).toHaveText("0");
});
