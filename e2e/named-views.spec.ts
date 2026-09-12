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
  ).toHaveCount(0);
  await page.keyboard.type("# OpenSource draft");
  await expect(
    page.locator('.main-tree[data-active-view="OpenSource"] [data-main-id]', { hasText: "OpenSource draft" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Current view: OpenSource/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Main"] [data-main-id]', { hasText: "OpenSource draft" }),
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

test("the new-item chooser keeps the named VIEW as its creation context, at the view root when no note is open there", async ({
  page,
}) => {
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

  await expect(folder.locator("..").locator(".main-row", { hasText: "Untitled" })).toHaveCount(0);
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.type("# Northstar note");
  // the view stays the context (membership), but a folder that is merely
  // selected no longer nests the item: it lands at the view's root
  await expect(
    page.locator('.main-tree[data-active-view="Northstar"] .main-row', { hasText: "Northstar note" }),
  ).toHaveCount(1);
  await expect(folder.locator("..").locator(".main-row", { hasText: "Northstar note" })).toHaveCount(0);
  await page.getByRole("button", { name: /Current view: Northstar/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Main"] [data-main-id]', { hasText: "Northstar note" }),
  ).toBeVisible();
});

test("any named view can be deleted from Main's picker, and Main keeps its items", async ({ page }) => {
  await gotoApp(page);
  const mainRows = page.locator('.main-tree[data-active-view="Main"] [data-main-id]');
  const before = await mainRows.count();
  for (const name of ["Alpha", "Beta"]) {
    await page.getByRole("button", { name: /Current view:/ }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
    await page.getByRole("textbox", { name: "New view" }).fill(name);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Current view: ${name}`) })).toBeVisible();
  }
  // back to Main, then delete Alpha without ever showing it
  await page.getByRole("button", { name: /Current view: Beta/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await page.getByRole("button", { name: /Current view: Main/ }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Delete a view…" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Alpha", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Delete Alpha? Items stay in Main.");
  await page.getByRole("alert").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: /Current view: Main/ })).toBeVisible();
  await expect(mainRows).toHaveCount(before);
  await page.getByRole("button", { name: /Current view: Main/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Beta" })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Alpha" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});
