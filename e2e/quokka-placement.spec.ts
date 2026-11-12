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

test("Tesven locks the line quokka (navy by day, white by night) and leaving it brings the person's look back", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  // the person's own look: a Berry body in glasses
  await page.getByRole("radio", { name: /^Berry/ }).click();
  await page.getByRole("radio", { name: /Glasses/ }).click();
  const preview = page.getByTestId("chat-buddy-preview").locator(".quokka");
  const banner = page.locator(".set-banner .quokka");
  await expect(preview.locator(".quokka-accessory-layer")).toHaveCount(1);

  await page.locator(".famcard", { hasText: "Tesven" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tesven-light");
  await expect(page.getByTestId("chat-buddy-locked")).toHaveText(
    "A quokka keeps you company in every chat and picks its own expression as the conversation goes. Tesven keeps the original line quokka. Your look comes back in other themes.",
  );
  // the controls are gone, not disabled
  await expect(page.getByRole("radiogroup", { name: "Quokka body color" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Quokka accessory" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Quokka line color" })).toHaveCount(0);
  for (const quokka of [preview, banner]) {
    await expect(quokka).toHaveCSS("color", "rgb(11, 37, 64)");
    await expect(quokka.locator(".quokka-body-layer, .quokka-accessory-layer")).toHaveCount(0);
  }

  await page.getByRole("radiogroup", { name: "Color scheme" }).getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tesven-dark");
  for (const quokka of [preview, banner]) {
    await expect(quokka).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(quokka.locator(".quokka-body-layer, .quokka-accessory-layer")).toHaveCount(0);
  }

  // another family: the stored look was never written, so it is all still there
  await page.locator(".famcard", { hasText: "Ocean" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean-dark");
  await expect(page.getByTestId("chat-buddy-locked")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /^Berry/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /Glasses/ })).toHaveAttribute("aria-checked", "true");
  await expect(preview.locator(".quokka-body-layer")).toHaveCount(1);
  await expect(preview.locator(".quokka-accessory-layer")).toHaveCount(1);
  await expect(banner.locator(".quokka-accessory-layer")).toHaveCount(1);
});
