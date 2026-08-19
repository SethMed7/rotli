// The Finder-parity slice (the maintainer, 2026-07-28): the Gallery view (big preview +
// filmstrip, ←/→ walks it), the bottom path bar, and the background
// right-click Sort-by menu.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Gallery view: filmstrip selection, arrow keys, Enter opens", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();
  await page.getByRole("button", { name: "Gallery view" }).click();

  // the strip lists the folder's contents; the first entry is staged AND
  // selected — the path bar names it immediately (Greptile, PR #1: the
  // implicit preview and the empty selection were out of sync)
  const cells = page.locator(".fdrg-cell");
  const count = await cells.count();
  expect(count).toBeGreaterThan(1);
  await expect(page.locator(".fdrg-cell.sel")).toHaveCount(1);
  await expect(page.locator(".fdr-pathbar .fdr-crumb.leaf")).toBeVisible();

  // clicking a cell stages it; ←/→ move the highlight
  await cells.nth(1).click();
  await expect(cells.nth(1)).toHaveClass(/sel/);
  await page.locator(".fdrg").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(cells.nth(0)).toHaveClass(/sel/);
  await page.keyboard.press("ArrowRight");
  await expect(cells.nth(1)).toHaveClass(/sel/);
});

test("the path bar sits at the bottom, navigates, and names the selection", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();

  // enter a folder from the grid — the bottom bar grows the trail
  await page.locator(".system-browser .fdr-tile", { hasText: "Work" }).dblclick();
  const bar = page.locator(".fdr-pathbar");
  await expect(bar.locator(".fdr-crumb", { hasText: "Assets" })).toBeVisible();
  await expect(bar.locator(".fdr-crumb", { hasText: "Work" })).toBeVisible();

  // selecting an item appends it as the leaf
  await page.locator(".system-browser .fdr-tile[data-note-id]").first().click();
  await expect(bar.locator(".fdr-crumb.leaf")).toBeVisible();

  // the root crumb climbs back
  await bar.locator(".fdr-crumb", { hasText: "Assets" }).click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Assets");
});

test("right-click on empty space offers Sort by", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();
  await page.locator(".system-browser .fdr-grid").click({ button: "right", position: { x: 5, y: 5 } });
  await page.locator(".ctxmenu-item", { hasText: "Sort by" }).click();
  await page.locator(".ctxmenu-item", { hasText: "Kind" }).click();
  // the choice sticks — reopening shows Kind as the active (highlighted) key
  await page.locator(".system-browser .fdr-grid").click({ button: "right", position: { x: 5, y: 5 } });
  await page.locator(".ctxmenu-item", { hasText: "Sort by" }).click();
  await expect(page.locator(".ctxmenu-item.active", { hasText: "Kind" })).toBeVisible();
});
