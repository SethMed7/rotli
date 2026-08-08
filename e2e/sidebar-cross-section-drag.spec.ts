// Cross-surface Main add (reworked 2026-07-26): System rows open the
// Finder-style browser on the right instead of inline sidebar dropdowns, so
// "drag a Storage note into Main" now starts from a BROWSER row (the shared
// startMainAddDrag in NoteListRow) and lands on the sidebar's Main zone —
// same reference-not-move contract as the old inline-tree drag.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("dragging a note from the Assets browser into Main adds a reference without moving it", async ({
  page,
}) => {
  await gotoApp(page);

  // Main starts empty — the empty-state paragraph itself is the drop target
  // (data-main-id="main:", the whole-Main-zone marker in mainDropAt)
  const mainRoot = page.locator('[data-main-id="main:"]');
  await expect(mainRoot).toContainText("arranged your way");

  // Assets is a SYSTEM row now: one click opens the browser surface
  await page.locator(".frow", { hasText: "Assets" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Assets");

  // Groceries sits at the Assets root — an icon tile in the Finder grid
  const source = page.locator(".system-browser .fdr-tile", { hasText: "Groceries" }).first();
  await expect(source).toBeVisible();

  await pointerDrag(page, source, await centerOf(mainRoot));

  // the note now appears under Main …
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Groceries" })).toBeVisible();
  // … and Assets still has its copy: Main is a reference, not a move
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "Groceries" })).toBeVisible();
});

test("dragging an item from the System browser onto Trash moves it there", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".frow", { hasText: "Assets" }).first().click();
  const source = page.locator(".system-browser .fdr-tile", { hasText: "Groceries" }).first();
  await expect(source).toBeVisible();

  const trash = page.locator(".sb-system .frow", { hasText: "Trash" }).first();
  await pointerDrag(page, source, await centerOf(trash));

  await expect(source).toHaveCount(0);
  await trash.click();
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "Groceries" })).toBeVisible();
});

test("the System browser is a real Finder: grid, columned list, folder entry, breadcrumb", async ({
  page,
}) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();

  // the search flattens across the root; a no-match query says so honestly
  const search = page.locator(".system-browser .allnotes-search input");
  await search.fill("Groceries");
  await expect(page.locator(".system-browser .recent-row", { hasText: "Groceries" })).toBeVisible();
  await search.fill("zzz-no-such-note");
  await expect(page.locator(".system-browser .be-title", { hasText: "No matches" })).toBeVisible();
  await search.fill("");

  // List = Finder's columned list: Name · Date Modified · Kind, folder rows included
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.locator(".system-browser .fdr-col", { hasText: "Date Modified" })).toBeVisible();
  await expect(page.locator(".system-browser .fdr-row", { hasText: "Groceries" })).toBeVisible();
  await expect(page.locator(".system-browser .fdr-row.folder", { hasText: "Work" })).toBeVisible();

  // Folders = the icon grid; double-clicking a folder ENTERS it and the
  // breadcrumb climbs back — spatial navigation, like a traditional Finder
  await page.getByRole("button", { name: "Icons view" }).click();
  await page.locator(".system-browser .fdr-tile", { hasText: "Work" }).dblclick();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Work");
  await page.locator(".system-browser .fdr-crumb", { hasText: "Assets" }).click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Assets");
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "Groceries" })).toBeVisible();
});

test("the Columns view drills like Finder's column view", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Library" }).first().click();
  await page.getByRole("button", { name: "Columns view" }).click();

  // column 1 lists the root's folders; clicking one opens column 2
  await page.locator(".fdrc-item.folder", { hasText: "Projects" }).click();
  await expect(page.locator(".fdrc-col")).toHaveCount(2);
  await expect(page.locator(".fdrc-item", { hasText: "Launch checklist" })).toBeVisible();

  // double-click opens the note in a tab
  await page.locator(".fdrc-item", { hasText: "Launch checklist" }).dblclick();
  await expect(page.locator(".tabstrip", { hasText: "Launch checklist" }).first()).toBeVisible();
});
