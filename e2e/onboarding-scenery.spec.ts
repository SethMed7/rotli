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

test("music gets a small player in the corner that stays through the rest of setup", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  const player = page.getByRole("region", { name: "Music", exact: true });
  await expect(player).toHaveCount(0); // before the Sound step, and with nothing chosen
  for (const _ of [1, 2]) await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Music while you write?" })).toBeVisible();
  await expect(player).toHaveCount(0); // Quiet
  const music = page.getByRole("radiogroup", { name: "Music" });
  await music.getByRole("radio", { name: /^Studio music/ }).click();
  await expect(player).toBeVisible();
  // pause keeps the music chosen, just not playing now
  await player.getByRole("button", { name: "Pause music" }).click();
  await expect(player.getByRole("button", { name: "Play music" })).toBeVisible();
  await expect(music.getByRole("radio", { name: /^Studio music/ })).toHaveAttribute("aria-checked", "true");
  const volume = player.getByRole("slider", { name: "Music volume" });
  await volume.fill("20");
  await expect(volume).toHaveValue("20");
  // Claude FM plays in its own page: no skipping, no volume of Rotli's
  await music.getByRole("radio", { name: /^Claude FM/ }).click();
  await expect(music.getByRole("radio", { name: /^Claude FM/ })).toHaveAttribute("aria-checked", "true");
  await expect(player).toContainText("Claude FM");
  await expect(player.getByRole("slider", { name: "Music volume" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "Next track" })).toHaveCount(0);
  await music.getByRole("radio", { name: /^Studio music/ }).click();
  // it comes along: Shortcuts, then where notes live
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(player.getByRole("button", { name: "Next track" })).toBeVisible();
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await expect(page.getByRole("heading", { name: "Where should your notes live?" })).toBeVisible();
  await expect(player).toBeVisible();
});

test("a step taller than a short window says there's more below", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  const cue = page.locator(".setup-stage-scroll-cue");
  await expect(cue).toBeVisible();
  await page.locator(".setup-stage").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(cue).toHaveCount(0);
  // the companion stays in view while the cards scroll
  await expect(page.locator(".setup-companion .quokka")).toBeInViewport({ ratio: 1 });
});

test("dark themes lift the sky's clouds to the tint so they don't vanish", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  await page
    .getByRole("radiogroup", { name: "Appearance mode" })
    .getByRole("radio", { name: "Dark" })
    .click();
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: /Grove/ }).click();
  const fills = await page
    .locator(".onb-scenery .sc-cloud")
    .first()
    .evaluate((cloud) => {
      const probe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      probe.style.fill = "var(--tint)";
      cloud.parentElement!.appendChild(probe);
      const tint = getComputedStyle(probe).fill;
      probe.remove();
      return { cloud: getComputedStyle(cloud).fill, tint };
    });
  expect(fills.cloud).toBe(fills.tint);
});
