// Manual file/folder management, restored (P0 sweep 2026-07-28): the System
// fold had severed every by-hand move and left folder creation with no working
// UI at all. "Move to…" lives in the row menu; "New folder" lives in the
// Library browser (and the sidebar's toolbar button routes there while a
// browser is open).

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("Move to… refiles a note into another Library area", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Launch checklist" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Library › People" }).click();

  // the note now lives in wiki/People — the Library browser proves it
  await page.locator(".frow", { hasText: "Library" }).first().click();
  await page.locator(".system-browser .fdr-tile", { hasText: "People" }).dblclick();
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "Launch checklist" })).toBeVisible();
});

test("the toolbar New-folder button creates a real folder at the browser's cwd", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".frow", { hasText: "Library" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Library");

  // the sidebar toolbar button routes to the open browser (it was a silent
  // no-op after the fold — the regression this spec locks out)
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const input = page.locator(".system-browser .fdr-newfolder input");
  await expect(input).toBeVisible();
  await input.fill("Ideas");
  await input.press("Enter");

  const tile = page.locator(".system-browser .fdr-tile", { hasText: "Ideas" });
  await expect(tile).toBeVisible();
  await expect(tile.locator(".fdr-tile-sub")).toHaveText("0 items");
});

test("Finder multi-select: ⌘-click, rubber band, and ⌘⌫ to Trash", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();

  // ⌘-click builds a selection
  await page.locator(".system-browser .fdr-tile", { hasText: "Groceries" }).click();
  await page.locator(".system-browser .fdr-tile", { hasText: "Quokka world" }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".system-browser .fdr-tile.sel")).toHaveCount(2);

  // clicking empty space clears; a rubber-band drag re-selects
  const scroll = page.locator(".system-browser .board-scroll");
  const box = await scroll.boundingBox();
  if (!box) throw new Error("no scroll box");
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20);
  await expect(page.locator(".system-browser .fdr-tile.sel")).toHaveCount(0);
  await page.mouse.move(box.x + box.width - 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.locator(".system-browser .fdr-tile.sel:not(:has(.fdr-tile-icon.folder))"),
  ).not.toHaveCount(0);

  // ⌘⌫ moves the selection to Trash
  await page.locator(".system-browser .fdr-tile", { hasText: "Groceries" }).click();
  await page.locator(".system-browser .fdr-tile", { hasText: "Quokka world" }).click({ modifiers: ["Meta"] });
  await page.keyboard.press("Meta+Backspace");
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "Groceries" })).toHaveCount(0);
  await page.locator(".frow", { hasText: "Trash" }).first().click();
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "Groceries" })).toBeVisible();
});
