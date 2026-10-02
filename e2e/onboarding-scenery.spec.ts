// First run's scenery (the owner, 2026-09-30): a short island intro opens
// setup on Rotli's island; a theme picked on the first screen shows its
// scenery at once, and every screen after it wears that scenery.

import { expect, test } from "@playwright/test";

const scenery = (page: import("@playwright/test").Page) => page.locator(".onb-scenery");

test("first run opens on the island intro, which gives way to Welcome on the island", async ({ page }) => {
  await page.goto("/?onboarding");
  const intro = page.getByTestId("onboarding-intro");
  await expect(intro).toBeVisible();
  await expect(intro).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByRole("heading", { name: "Make Rotli yours." })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Make Rotli yours." })).toBeVisible();
  await expect(page.getByTestId("onboarding-intro")).toHaveCount(0);
});

test("the chosen theme's scenery shows as it's picked and follows every screen after", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  // Rotli's own theme is the island; another pick previews its scenery live
  await expect(scenery(page)).toHaveAttribute("data-scenery", "island");
  const themes = page.getByRole("radiogroup", { name: "Theme" });
  await themes.getByRole("radio", { name: /Ocean/ }).click();
  await expect(scenery(page)).toHaveAttribute("data-scenery", "ocean");
  await themes.getByRole("radio", { name: /Midnight/ }).click();
  await expect(scenery(page)).toHaveAttribute("data-scenery", "midnight");
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

test("nothing sounds during setup; afterward the player waits for Play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?onboarding");
  const playing = async () => (await ambientAudio(page))?.playing ?? false;
  // no corner player anywhere in setup
  await expect(page.getByRole("region", { name: "Now playing" })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Music Vault");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Create vault here", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  // the player is there, quiet, until the person presses Play
  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await card.getByRole("button", { name: "Take the tour" }).click();
  await page.getByRole("button", { name: "Skip tour" }).click();
  const player = page.getByRole("region", { name: "Now playing" });
  await expect(player).toBeVisible();
  await page.waitForTimeout(400);
  expect(await playing()).toBe(false);
  await player.getByRole("button", { name: "Play", exact: true }).click();
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

test("the opening takes its time, and waits for the window to be in front", async ({ page }) => {
  // unhurried: on screen for well over two seconds, from the moment it mounts
  // (timed in the page, so a slow load can't eat into it)
  await page.addInitScript(() => {
    const w = window as { openingShown?: number; openingGone?: number };
    new MutationObserver(() => {
      const here = document.querySelector('[data-testid="app-opening"]') !== null;
      if (here) w.openingShown ??= performance.now();
      else if (w.openingShown !== undefined) w.openingGone ??= performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/?opening");
  await expect(page.getByTestId("app-opening")).toHaveCount(0, { timeout: 8000 });
  const shownFor = await page.evaluate(() => {
    const w = window as { openingShown?: number; openingGone?: number };
    return (w.openingGone ?? 0) - (w.openingShown ?? 0);
  });
  expect(shownFor).toBeGreaterThan(2400);
  // a window launched behind others (a menu-bar app isn't activated by its
  // own start) holds the opening until it comes forward
  await page.addInitScript(() => {
    let focused = false;
    Document.prototype.hasFocus = () => focused;
    // the browser's own focus events don't count until the window comes forward
    window.addEventListener("focus", (event) => focused || event.stopImmediatePropagation(), true);
    (window as { bringForward?: () => void }).bringForward = () => {
      focused = true;
      window.dispatchEvent(new Event("focus"));
    };
  });
  await page.goto("/?opening");
  const opening = page.getByTestId("app-opening");
  await page.waitForTimeout(3200);
  await expect(opening).toHaveClass(/is-waiting/);
  await page.evaluate(() => (window as { bringForward?: () => void }).bringForward?.());
  await expect(opening).not.toHaveClass(/is-waiting/);
  await expect(opening).toHaveCount(0, { timeout: 4000 });
});

test("an opening waiting to be seen never holds the app", async ({ page }) => {
  // a window in front whose web view never reports focus (seen on macOS 27)
  await page.addInitScript(() => {
    Document.prototype.hasFocus = () => false;
    window.addEventListener("focus", (event) => event.stopImmediatePropagation(), true);
  });
  await page.goto("/?opening");
  const opening = page.getByTestId("app-opening");
  await expect(opening).toHaveClass(/is-waiting/);
  // the click that brings the window forward plays it rather than skipping it
  await page.mouse.click(10, 10);
  await expect(opening).not.toHaveClass(/is-waiting/);
  await expect(opening).toBeVisible();
  await expect(opening).toHaveCount(0, { timeout: 4000 });
  // with no click or key at all it gives way on its own
  await page.goto("/?opening");
  await expect(page.getByTestId("app-opening")).toHaveClass(/is-waiting/);
  await expect(page.getByTestId("app-opening")).toHaveCount(0, { timeout: 7000 });
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
