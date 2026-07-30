// Folder multi-select in the System browser (Seth, 2026-07-30: "in the
// Library I can't select multiple things via drag or via holding command").
// Folder tiles now join the same selection grammar items always had:
// ⌘-click toggles, and the empty-space marquee gathers folder tiles too.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

async function openLibrary(page: import("@playwright/test").Page) {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Library" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Library");
}

test("⌘-click gathers multiple folder tiles; plain click collapses to one", async ({ page }) => {
  await openLibrary(page);

  const projects = page.locator(".system-browser .fdr-tile", { hasText: "Projects" });
  const people = page.locator(".system-browser .fdr-tile", { hasText: "People" });
  await projects.click();
  await expect(projects).toHaveClass(/sel/);

  await people.click({ modifiers: ["Meta"] });
  await expect(projects).toHaveClass(/sel/);
  await expect(people).toHaveClass(/sel/);

  // ⌘-click a selected tile removes just it
  await projects.click({ modifiers: ["Meta"] });
  await expect(projects).not.toHaveClass(/sel/);
  await expect(people).toHaveClass(/sel/);

  // a plain click collapses back to a single selection
  await projects.click();
  await expect(projects).toHaveClass(/sel/);
  await expect(people).not.toHaveClass(/sel/);
});

test("the empty-space marquee sweeps up folder tiles", async ({ page }) => {
  await openLibrary(page);

  const grid = page.locator(".system-browser .fdr-grid");
  const first = grid.locator(".fdr-tile").first();
  const last = grid.locator(".fdr-tile").last();
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  if (!a || !b) throw new Error("folder tiles have no geometry");

  // start on EMPTY space below the tiles, sweep up across them all
  const startX = a.x - 8;
  const startY = Math.max(a.y + a.height, b.y + b.height) + 40;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 8, a.y - 8, { steps: 10 });

  const tiles = grid.locator(".fdr-tile");
  const count = await tiles.count();
  await expect(grid.locator(".fdr-tile.sel")).toHaveCount(count);
  await page.mouse.up();
  // the selection survives the release
  await expect(grid.locator(".fdr-tile.sel")).toHaveCount(count);
});
