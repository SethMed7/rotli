// The sidebar, alive (2026-10-01): Settings → Appearance → Sidebar picks the
// scenery (Off, Top, Bottom, Both — the theme's own still scene) and the icons
// (Neutral, Color).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("sidebar scenery and icons follow Settings, and the scene never takes a click", async ({ page }) => {
  await gotoApp(page);
  const sidebar = page.locator(".sidebar");
  // a quiet scene at the top by default, in the theme's family
  await expect(sidebar.locator("[data-scenery]")).toHaveCount(1);
  await expect(sidebar.locator("[data-scenery]")).toHaveAttribute("data-scenery", /:top$/);
  await expect(sidebar).toHaveAttribute("data-icons", "neutral");

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const field = (label: string) => page.locator(".segfield", { hasText: label });
  await field("Scenery").getByRole("button", { name: "Both", exact: true }).click();
  await field("Icons").getByRole("button", { name: "Color", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(sidebar.locator("[data-scenery]")).toHaveCount(2);
  await expect(sidebar).toHaveAttribute("data-icons", "color");
  // under the rows: the header's buttons still take their clicks
  await expect(sidebar.locator(".sb-scene").first()).toHaveCSS("pointer-events", "none");
  // the owner, 2026-10-01: "it can't make things hard to see" — a few percent
  // of ink, kept to the header row and the footer, never under the rows
  for (const scene of await sidebar.locator(".sb-scene").all()) {
    expect(Number(await scene.evaluate((node) => getComputedStyle(node).opacity))).toBeLessThanOrEqual(0.08);
    expect((await scene.boundingBox())?.height ?? 0).toBeLessThanOrEqual(64);
  }
  await page.getByRole("button", { name: "Collapse all folders" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await field("Scenery").getByRole("button", { name: "Off", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(sidebar.locator("[data-scenery]")).toHaveCount(0);
});
