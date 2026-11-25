// The sidebar's icons: Settings → Appearance → Sidebar picks Neutral or Color.
// (The scenery behind the sidebar was removed 2026-11-24.)

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("sidebar icons follow Settings, and the sidebar has no scenery", async ({ page }) => {
  await gotoApp(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator("[data-scenery], .sb-scene")).toHaveCount(0);
  await expect(sidebar).toHaveAttribute("data-icons", "neutral");

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".segfield", { hasText: "Scenery" })).toHaveCount(0);
  await page
    .locator(".segfield", { hasText: "Icons" })
    .getByRole("button", { name: "Color", exact: true })
    .click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-icons", "color");
  await expect(sidebar.locator("[data-scenery], .sb-scene")).toHaveCount(0);
});
