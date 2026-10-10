// The vault menu sits over the panes beside the sidebar (the owner,
// 2026-10-09: the note's header and a board's canvas drew over it). The living
// sidebar isolates its layers (notes.css `.sidebar { isolation: isolate }`), so
// a menu drawn inside it could never rise above the panes; it is drawn at the
// top of the page instead.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the vault menu is on top wherever it overhangs the panes", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".vault-switch").click();
  const menu = page.getByRole("menu", { name: "Vaults" });
  await expect(menu).toBeVisible();
  const covered = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar")!.getBoundingClientRect();
    // every point of the menu's part beyond the sidebar's right edge
    const misses: string[] = [];
    for (let x = sidebar.right + 4; x < box.right - 2; x += 24)
      for (let y = box.top + 4; y < box.bottom - 2; y += 12) {
        const top = document.elementFromPoint(x, y);
        if (!top || !element.contains(top)) misses.push(`${Math.round(x)},${Math.round(y)}`);
      }
    return { overhang: box.right - sidebar.right, misses };
  });
  expect(covered.overhang).toBeGreaterThan(40);
  expect(covered.misses).toEqual([]);
});
