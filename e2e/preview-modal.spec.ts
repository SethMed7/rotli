// Quick Look (Seth, 2026-07-29): "offer a preview so I don't have to open it
// fully" — the row menu's Preview and Space in the System browser open a modal
// peek; Esc and × close it; Open escalates to the real surface.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test("row-menu Preview opens the peek, Esc closes, Space reopens", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();

  const tile = page.locator(".system-browser .fdr-tile", { hasText: "Groceries" });
  await tile.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Preview" }).click();
  const modal = page.locator(".pvw");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".pv-title")).toContainText("Groceries");
  // focus lands on the peek's primary action (DESIGN.md focus law)
  await expect(modal.locator(".pv-open")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);

  // Space on the selected tile = Finder's Quick Look
  await tile.click();
  await page.keyboard.press(" ");
  await expect(page.locator(".pvw")).toBeVisible();
  await page.locator(".pv-x").click();
  await expect(page.locator(".pvw")).toHaveCount(0);
});

test("Open escalates from the peek to the real surface", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();
  await page.locator(".system-browser .fdr-tile", { hasText: "Groceries" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Preview" }).click();
  await page.locator(".pv-open").click();
  await expect(page.locator(".pvw")).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Groceries");
});
