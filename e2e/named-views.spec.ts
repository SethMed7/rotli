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
  await page.getByRole("button", { name: "Save", exact: true }).click();

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

test("Chat leaves named views to Home: no view row, and Search chats is every chat", async ({ page }) => {
  await gotoApp(page);
  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await viewSwitcher.scrollIntoViewIfNeeded();
  await viewSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Client work");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const chatFront = page.locator(".sb-chat");
  await expect(chatFront.getByRole("button", { name: /Current view:/ })).toHaveCount(0);
  await expect(chatFront).not.toContainText("Client work");
  const search = page.getByRole("button", { name: "Search chats", exact: true });
  await expect(search).not.toHaveClass(/\bsel\b/);
  await search.click();
  await expect(search).toHaveClass(/\bsel\b/);
  await expect(page.getByRole("textbox", { name: "Search all chats" })).toBeVisible();

  // Home still wears the view it was left in
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: /Current view: Client work/ })).toBeVisible();
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
  await page.getByRole("button", { name: "Save", exact: true }).click();

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
    await page.getByRole("button", { name: "Save", exact: true }).click();
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

// The owner, 2026-09-21: "I need ability to toggle between views while in chat
// too. And any sort of ⌘T/⌘N needs to be aware of the view I am in — but Main
// is still everything."
test("Chat switches views without leaving Chat, and ⌘T there files into that view and Main", async ({
  page,
}) => {
  await gotoApp(page);
  const homeSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await homeSwitcher.scrollIntoViewIfNeeded();
  await homeSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Research");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Research stays the active view; do the rest from the Chat front
  await expect(page.getByRole("button", { name: /Current view: Research/ })).toBeVisible();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // ⌘T from here makes a note in Research — and in Main, which holds everything
  await page.keyboard.press("Meta+T");
  await page.keyboard.type("# Research draft");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Research"] [data-main-id]', { hasText: "Research draft" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Current view: Research/ })
    .first()
    .click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Main"] [data-main-id]', { hasText: "Research draft" }),
  ).toBeVisible();

  // the Chat front: one New chat, and the title bar's folder button makes a
  // project there (written through the Mac app's corpus — the owner's check)
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator('.icobtn[aria-label="New project"]')).toBeEnabled();
  await expect(page.locator(".sb-chat .sb-chatnew")).toHaveCount(1);
  await page.locator(".sb-chat .sb-chatnew").click();
  await expect(page.locator(".pane.focused [data-chat-pane]")).toBeVisible();
});

test("the New view card closes from its ×, Escape, and a click outside", async ({ page }) => {
  await gotoApp(page);
  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  const card = page.getByRole("group", { name: "New view" });
  const openCard = async () => {
    await viewSwitcher.scrollIntoViewIfNeeded();
    await viewSwitcher.click();
    await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
    await expect(card.getByRole("textbox", { name: "New view" })).toBeFocused();
  };

  await openCard();
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);

  await openCard();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Escape from the Save button too, where the input's own key handler can't hear it
  await openCard();
  await card.getByRole("button", { name: "Save", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  await openCard();
  await page
    .locator(".pane")
    .first()
    .click({ position: { x: 40, y: 120 } });
  await expect(card).toHaveCount(0);
  // nothing was created along the way
  await expect(viewSwitcher).toBeVisible();
});
