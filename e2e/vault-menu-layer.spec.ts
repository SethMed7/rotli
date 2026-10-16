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

// A row's "…" opens that vault's actions IN the menu (the owner, 2026-10-10:
// the menu vanished and a detached one floated over the panes). Back returns
// to the rows, and Remove from Rotli never offers to delete anything.
test("a vault row's actions open in place inside the vault menu, and Back returns", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".vault-switch").click();
  const menu = page.getByRole("menu", { name: "Vaults" });
  await menu
    .getByRole("menuitem", { name: /^More options for / })
    .first()
    .click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Location settings…" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Remove from Rotli…" })).toBeVisible();
  // no second, detached menu
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
  // the twin's lone vault: removing it asks for the vault to use instead first,
  // and says nothing on disk is deleted
  await menu.getByRole("menuitem", { name: "Remove from Rotli…" }).click();
  await expect(menu).toContainText("is your only vault");
  await expect(menu).toContainText("Nothing is deleted.");
  await expect(menu.getByRole("menuitem", { name: "Choose a vault…" })).toBeVisible();
  await menu.locator(".vault-menu-back").click();
  await expect(menu.getByRole("menuitem", { name: "Location settings…" })).toBeVisible();
  await menu.locator(".vault-menu-back").click();
  await expect(menu.getByRole("menuitem", { name: "Connect vault" })).toBeVisible();
});
