// Manual file/folder management: "Move to…" retired 2026-07-28 (it listed
// Library areas regardless of the view — the System browser and the Librarian
// own placement); Duplicate is the by-hand copy verb in its place. "New
// folder" lives in the Library browser (and the sidebar's toolbar button
// routes there while a browser is open).

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("Duplicate copies a note as 'title copy' and opens it", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Launch checklist" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  // the copy opens as the active tab, named after its source
  await expect(page.getByRole("tab", { selected: true })).toContainText("Launch checklist copy");
  // and the old Move to… verb is gone from the row menu (opening the copy
  // left the list view — return to it first)
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Groceries" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move to…" })).toHaveCount(0);
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
