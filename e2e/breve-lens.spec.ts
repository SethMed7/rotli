// Breve is reachable by name from the sidebar switcher, keeps the way back
// visible, and defaults its PDF appearance to the app theme (audit
// 2026-09-02 §1.3–1.4). Browser mode renders the empty snapshot, so this
// proves the chrome and the settings shape, not the scheduler.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Breve is a labelled switcher segment and the chrome survives the trip", async ({ page }) => {
  await gotoApp(page);
  const switcher = page.getByRole("group", { name: "Sidebar front" });
  const breve = switcher.getByRole("button", { name: "Breve" });
  await expect(breve).toBeVisible();
  await expect(breve).toHaveAttribute("aria-pressed", "false");

  await breve.click();
  await expect(page.getByRole("main", { name: /^Breve/ })).toBeVisible();
  await expect(breve).toHaveAttribute("aria-pressed", "true");
  await expect(switcher.getByRole("button", { name: "Home" })).toHaveAttribute("aria-pressed", "false");
  // the vault switcher and the utility footer stay put while in Breve
  await expect(page.getByRole("button", { name: /^Vault:/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Settings/ }).first()).toBeVisible();
  // no health alert without a scheduler in this vault
  await expect(page.locator("[data-breve-health='warn']")).toHaveCount(0);

  // the way back is the same control
  await switcher.getByRole("button", { name: "Home" }).click();
  await expect(breve).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("main", { name: /^Breve/ })).toHaveCount(0);
});

test("PDF appearance defaults to Match Rotli and previews the live theme", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("group", { name: "Sidebar front" }).getByRole("button", { name: "Breve" }).click();
  await page.locator('button[data-breve-view="settings"]').click();
  const select = page.locator("#breve-pdf-theme");
  await expect(select).toHaveValue("rotli");
  const preview = page.locator(".breve-pdf-preview");
  const pageColour = await preview.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--pdf-preview-bg").trim(),
  );
  const ground = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ground").trim().toLowerCase(),
  );
  expect(pageColour.toLowerCase()).toBe(ground);

  // switching the app theme re-previews without touching the select
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "charcoal"));
  await expect
    .poll(async () =>
      preview.evaluate((el) => getComputedStyle(el).getPropertyValue("--pdf-preview-bg").trim()),
    )
    .not.toBe(pageColour);
  await expect(select).toHaveValue("rotli");
});
