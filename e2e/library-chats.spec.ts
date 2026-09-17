// The Library is the vault, so the vault's chats/ transcripts browse in it —
// under a Chats folder, marked as chats, and opening as the FILE they are:
// a Markdown note in the editor (the owner, 2026-09-17: "I should be able to
// edit it"). The Chat front is where the same file opens as a chat.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the Library shows a Chats folder whose rows are chats and open as editable transcript notes", async ({
  page,
}) => {
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
  // it opened as a note in the editor — the transcript as written, editable
  await expect(page.getByRole("tab", { selected: true })).toContainText(/planning chat/i);
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Messages");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".chat-empty, .chat-thread")).toHaveCount(0);
  // and Main / All notes still do not list it (the Chat front owns chats)
  await expect(page.locator(".main-tree").getByText(/planning chat/i)).toHaveCount(0);
});
