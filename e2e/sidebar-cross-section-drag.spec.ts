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

  const source = page.locator(".system-browser .recent-row", { hasText: "Groceries" }).first();
  await expect(source).toBeVisible();

  await pointerDrag(page, source, await centerOf(mainRoot));

  // the note now appears under Main …
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Groceries" })).toBeVisible();
  // … and Assets still has its copy: Main is a reference, not a move
  await expect(page.locator(".system-browser .recent-row", { hasText: "Groceries" })).toBeVisible();
});

test("the System browser searches and toggles between Folders and List", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();

  // the search narrows instantly; a no-match query says so honestly
  const search = page.locator(".system-browser .allnotes-search input");
  await search.fill("Groceries");
  await expect(page.locator(".system-browser .recent-row", { hasText: "Groceries" })).toBeVisible();
  await search.fill("zzz-no-such-note");
  await expect(page.locator(".system-browser .be-title", { hasText: "No matches" })).toBeVisible();
  await search.fill("");

  // Folders ⇄ List — both render the same items, structured vs flat
  await page.locator(".system-browser .fsh-tab", { hasText: "List" }).click();
  await expect(page.locator(".system-browser .sysb-folder")).toHaveCount(0);
  await page.locator(".system-browser .fsh-tab", { hasText: "Folders" }).click();
  await expect(page.locator(".system-browser .recent-row", { hasText: "Groceries" })).toBeVisible();
});
