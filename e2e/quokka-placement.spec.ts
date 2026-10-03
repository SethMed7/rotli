import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

const settingsPanes = [
  "General",
  "Keybindings",
  "Appearance",
  "Browser",
  "Librarian",
  "Security",
  "AI Models",
  "Location",
  "Connections",
  "About Rotli",
] as const;

test("every Settings pane opens on a banner with the person's quokka, and it follows the theme", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  // the banner shows the person's own quokka, dressed as they dressed it
  await page.getByRole("radio", { name: /Glasses/ }).click();

  for (const pane of settingsPanes) {
    await page.getByRole("button", { name: pane, exact: true }).click();
    const banner = page.locator(".set-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("heading", { level: 3 })).toBeVisible();
    await expect(banner.locator(".quokka")).toHaveCount(1);
    await expect(banner.locator(".quokka-accessory-layer")).toHaveCount(1);
  }

  await page.getByRole("button", { name: "General", exact: true }).click();
  await expect(page.locator(".set-banner")).toHaveAttribute("data-banner", "warm:general");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator(".famcard", { hasText: "Ocean" }).click();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await expect(page.locator(".set-banner")).toHaveAttribute("data-banner", "ocean:general");
});
