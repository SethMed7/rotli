// The Library is the vault, so the vault's chats/ transcripts browse in it —
// under a Chats folder, marked as chats, opening as chats (not as note files).
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the Library shows a Chats folder whose rows are chats and open as chats", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Library" }).first().click();
  const chats = page.locator('[data-folder-path="wiki/chats"]').first();
  await expect(chats).toBeVisible();
  await expect(chats).toContainText("Chats");
  await chats.dblclick();
  // list view names the kind
  await page.getByRole("button", { name: "List" }).click();
  const row = page.locator("[data-note-id]", { hasText: "Planning chat" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Chat");
  await row.dblclick();
  // it opened as a chat pane, not a note editor
  await expect(page.getByRole("tab", { selected: true })).toContainText(/planning chat/i);
  // the chat surface (the twin has no runtime, so its empty state stands in for the composer)
  await expect(page.locator(".chat-empty, .chat-thread").first()).toBeVisible();
  // and Main / All notes still do not list it (the Chat front owns chats)
  await expect(page.locator(".main-tree").getByText(/planning chat/i)).toHaveCount(0);
});
