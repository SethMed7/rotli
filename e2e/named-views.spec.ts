// Named-view regression: Main remains the global reference view, while a
// compact switcher selects one additional organization tree. Creation targets
// the active view and right-click assignment never removes the Main reference.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("successful background tree saves stay visually silent", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Quiet save");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");

  await expect(page.locator('.main-tree [data-main-folder="1"]', { hasText: "Quiet save" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^(Saving…|Saved)$/ })).toHaveCount(0);
});

test("named views keep Main global and make Command-T context-sensitive", async ({ page }) => {
  await gotoApp(page);

  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await viewSwitcher.scrollIntoViewIfNeeded();
  await viewSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("OpenSource");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: /Current view: OpenSource/ })).toBeVisible();
  await page.keyboard.press("Meta+T");
  await expect(
    page.locator('.main-tree[data-active-view="OpenSource"] [data-main-id]', { hasText: "Untitled" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Current view: OpenSource/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Main"] [data-main-id]', { hasText: "Untitled" }),
  ).toBeVisible();

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: "Q3 priorities — Northstar" });
  await source.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Move to view" }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "OpenSource" }).click();

  await page.getByRole("button", { name: /Current view: Main/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "OpenSource" }).click();
  const projected = page.locator('.main-tree[data-active-view="OpenSource"] [data-main-id]', {
    hasText: "Q3 priorities — Northstar",
  });
  await expect(projected).toBeVisible();
  await projected.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Remove from OpenSource" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move to Trash" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy File Path" })).toBeDisabled();
});

test("Chat names the inherited Notes view and can leave it for all chats", async ({ page }) => {
  await gotoApp(page);

  // Keep All chats as the content surface while Home changes the shared named
  // view; the old UI then highlighted "All chats" beside a filtered list.
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "All chats", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();

  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await viewSwitcher.scrollIntoViewIfNeeded();
  await viewSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Client work");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const context = page.getByRole("group", { name: "Chat view context" });
  await expect(context).toContainText("Client work");
  const allChats = page.getByRole("button", { name: "All chats", exact: true });
  await expect(allChats).not.toHaveClass(/\bsel\b/);

  await context.getByRole("button", { name: "Show all chats" }).click();
  await expect(context).toHaveCount(0);
  await expect(allChats).toHaveClass(/\bsel\b/);

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: /Current view: Main/ })).toBeVisible();
});

test("the new-item chooser keeps a named view folder as its creation context", async ({ page }) => {
  await gotoApp(page);

  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await viewSwitcher.scrollIntoViewIfNeeded();
  await viewSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Northstar");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "New folder in Northstar" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Boards");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree[data-active-view="Northstar"] [data-main-folder="1"]', {
    hasText: "Boards",
  });
  await folder.click();

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  // Browser mode cannot invoke the native board creator. Markdown takes the
  // same shared filing path and proves named-view membership + folder nesting.
  await page.locator(".ni-surface").getByRole("button", { name: "New Markdown note" }).click();

  await expect(folder.locator("..").locator(".main-row", { hasText: "Untitled" })).toHaveCount(1);
  await page.getByRole("button", { name: /Current view: Northstar/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Main"] [data-main-id]', { hasText: "Untitled" }),
  ).toBeVisible();
});
