// Ask AI (`/ai`, 2026-10-05). The browser twin has no model lanes, so this
// proves the shape a person meets — the command leads its search, its popover
// opens at the cursor and says plainly when there is no model, and closing it
// leaves the note as it was. The happy path (a model's answer, Insert through
// corpus_insert_ai) is unit-tested and on the owner's native checklist.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("/ai opens Ask AI at the cursor and says so when there is no model", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page.locator(".ni-surface").getByRole("button", { name: "New Markdown note" }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("Before\n/ai");

  // the best match leads the menu, so Enter picks it
  await expect(page.getByRole("menuitem").first()).toContainText("Ask AI");
  await page.getByRole("menuitem", { name: /Ask AI/ }).click();

  const popover = page.getByRole("dialog", { name: "Ask AI" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("No model to ask yet.");
  await popover.press("Escape");
  await expect(popover).toHaveCount(0);
  // the `/ai` the person typed is cleared; nothing else changed
  await expect(editor).toContainText("Before");
  await expect(editor).not.toContainText("/ai");
});
