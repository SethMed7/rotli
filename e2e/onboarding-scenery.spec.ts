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

/** The one ambient element's state (services/ambient.ts keeps it on the window). */
const ambientAudio = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const audio = (globalThis as { __rotliAmbientAudio?: HTMLAudioElement }).__rotliAmbientAudio;
    return audio ? { playing: !audio.paused, src: audio.src } : null;
  });

test("setup's music only previews; what you pick starts once setup is done", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  for (const _ of [1, 2]) await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Music while you write?" })).toBeVisible();
  const music = page.getByRole("radiogroup", { name: "Music" });
  // picking it doesn't start it
  await music.getByRole("radio", { name: /^Studio music/ }).click();
  await expect(music.getByRole("radio", { name: /^Studio music/ })).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(400);
  expect((await ambientAudio(page))?.playing ?? false).toBe(false);
  // its card's own play button previews it, and stops it
  const studioPreview = () => page.getByRole("button", { name: /^(Preview|Stop previewing) Linen$/ });
  const playing = async () => (await ambientAudio(page))?.playing ?? false;
  await studioPreview().click();
  await expect(studioPreview()).toHaveAttribute("aria-pressed", "true");
  await expect.poll(playing).toBe(true);
  await studioPreview().click();
  await expect(studioPreview()).toHaveAttribute("aria-pressed", "false");
  await expect.poll(playing).toBe(false);
  // a preview left playing stops with the step
  await studioPreview().click();
  await expect.poll(playing).toBe(true);
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByRole("heading", { name: /Three shortcuts/ })).toBeVisible();
  await expect.poll(playing).toBe(false);
  // no corner player anywhere in setup
  await expect(page.getByRole("region", { name: "Music", exact: true })).toHaveCount(0);

  // finish setup: the music picked starts
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Music Vault");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Use empty folder", exact: true }).click();
  await page.getByRole("button", { name: /^Create vault/ }).click();
  await page.getByRole("button", { name: "Skip model setup" }).click();
  await expect.poll(playing, { timeout: 8000 }).toBe(true);
});

test("the app opens on its opening scene each launch, in the person's theme", async ({ page }) => {
  await page.goto("/?opening");
  const opening = page.getByTestId("app-opening");
  await expect(opening).toBeVisible();
  await expect(opening).toHaveCount(0, { timeout: 4000 });
  // a key skips it at once
  await page.goto("/?opening");
  await expect(page.getByTestId("app-opening")).toBeVisible();
  await page.keyboard.press("Shift");
  await expect(page.getByTestId("app-opening")).toHaveCount(0, { timeout: 500 });
});

test("no opening with Reduce motion on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?opening");
  await page.getByRole("tablist").waitFor();
  await expect(page.getByTestId("app-opening")).toHaveCount(0);
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
