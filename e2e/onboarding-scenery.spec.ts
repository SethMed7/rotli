// First run's scenery (the owner, 2026-09-30): a short island intro opens
// setup, Welcome shows Rotli's island, and once a theme is chosen every step
// after it — through where notes live — wears that theme's scenery.

import { expect, test } from "@playwright/test";

const scenery = (page: import("@playwright/test").Page) => page.locator(".onb-scenery");

test("first run opens on the island intro, which gives way to Welcome on the island", async ({ page }) => {
  await page.goto("/?onboarding");
  const intro = page.getByTestId("onboarding-intro");
  await expect(intro).toBeVisible();
  await expect(intro).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByRole("heading", { name: "Make Rotli feel like yours." })).toBeVisible();
  await expect(scenery(page)).toHaveAttribute("data-scenery", "island");
});

test("a key skips the intro at once", async ({ page }) => {
  await page.goto("/?onboarding");
  const intro = page.getByTestId("onboarding-intro");
  await expect(intro).toBeVisible();
  await page.keyboard.press("Shift");
  await expect(intro).toHaveCount(0, { timeout: 500 });
});

test("with Reduce motion on there is no intro", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  await expect(page.getByRole("heading", { name: "Make Rotli feel like yours." })).toBeVisible();
  await expect(page.getByTestId("onboarding-intro")).toHaveCount(0);
});

test("the chosen theme's scenery follows every step after Appearance", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  // Appearance previews each pick live
  const themes = page.getByRole("radiogroup", { name: "Theme" });
  await themes.getByRole("radio", { name: /Ocean/ }).click();
  await expect(scenery(page)).toHaveAttribute("data-scenery", "ocean");
  await themes.getByRole("radio", { name: /Midnight/ }).click();
  await expect(scenery(page)).toHaveAttribute("data-scenery", "midnight");
  for (const _ of ["Window", "Sound", "Shortcuts"]) {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(scenery(page)).toHaveAttribute("data-scenery", "midnight");
  }
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await expect(page.getByRole("heading", { name: "Where should your notes live?" })).toBeVisible();
  await expect(scenery(page)).toHaveAttribute("data-scenery", "midnight");
});

test("Welcome previews the island once: in the corner on short windows, on the horizon on tall ones", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sky = page.locator(".onb-scenery .onb-scenery-sky");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?onboarding");
  await expect(page.locator(".onb-scenery")).toHaveAttribute("data-scenery", "island");
  await expect(sky).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 960 });
  await expect(sky).toBeHidden();
});
