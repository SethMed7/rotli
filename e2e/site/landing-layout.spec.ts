// The landing's layout of 2026-10-05 (docs/design/landing-layout-2026-10-05.md): the section
// order and its grounds, the three cards with their drawn pictures, the before and after's
// filing play (it plays once in view, holds off screen, rests marked, and replays), the tour
// (pinned beside its list and stepped by the scroll on wide screens, a click or a key moving to
// a part's step, a plain sequence on phones and without script), and the closing banner, whose
// art never sits on its words. This suite's build has WEB_APP_ENABLED off, so the tour has five
// parts; each check holds with the sixth part too. The banner's one way in is "Try now", to
// /download/.
import { expect, test, type Locator, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tourButtons = (page: Page) => page.locator(".tour-name button");
const HEADER = 68;
// The scroll position that puts a step's anchor middle on the line across the window: the
// same rule the page uses (site/src/tourSteps.ts), read from the live layout.
const stepY = (page: Page, i: number) =>
  page
    .locator(".tour-anchor")
    .nth(i)
    .evaluate((anchor) => {
      const box = anchor.getBoundingClientRect();
      return Math.round(box.top + scrollY + box.height / 2 - innerHeight / 2);
    });
const scrollToY = (page: Page, y: number) =>
  page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
const shownStep = (page: Page) => page.locator('.tour-name button[aria-current="true"]');

test("the sections run in order, alternating plain and warm grounds", async ({ page }) => {
  await page.goto("/");
  const ids = await page
    .locator("main > section")
    .evaluateAll((sections) => sections.map((s) => s.id || s.classList[0]));
  expect(ids).toEqual([
    "hero",
    "waiting",
    "features",
    "two-kinds",
    "tour",
    "personal",
    "privacy",
    "faq",
    "start",
  ]);
  const warm = await page
    .locator("main > section")
    .evaluateAll((sections) => sections.map((s) => s.classList.contains("band-warm")));
  expect(warm).toEqual([false, true, false, true, false, true, false, false, false]);
});

test("three cards say what rotli does, each a drawn picture over a heading and one sentence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const cards = page.locator(".overview .card");
  await expect(cards.locator("h3")).toHaveText([
    "Write in plain Markdown",
    "Keep it in your folder",
    "Ask your notes",
  ]);
  for (const card of await cards.all()) {
    const picture = card.getByRole("img").first();
    await expect(picture).toHaveAttribute("aria-label", /.+/);
    await expect(card.locator(".stage .quokka")).toHaveCount(1);
    await expect(card.locator("> p")).toHaveCount(1);
  }
  // No screenshots: the pictures are HTML in the app's words.
  await expect(cards.locator(".stage img:not(.quokka)")).toHaveCount(0);
  await expect(cards.nth(1).locator(".pill")).toHaveText("Projects");
  await expect(cards.nth(1).locator(".tick")).toHaveCount(4);
  // The headings line up across the row.
  const tops = await cards
    .locator("h3")
    .evaluateAll((titles) => titles.map((t) => Math.round(t.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
});

test("the tour follows the scroll: each step pins its part beside the list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const body = page.locator(".tour-body");
  await expect(body).toHaveClass(/is-pinned/);
  const buttons = tourButtons(page);
  const count = await buttons.count();
  expect([5, 6]).toContain(count);
  await expect(page.locator(".tour-anchor")).toHaveCount(count);

  let pinTop: number | null = null;
  for (let i = 0; i < count; i++) {
    await scrollToY(page, await stepY(page, i));
    await expect(buttons.nth(i)).toHaveAttribute("aria-current", "true");
    await expect(shownStep(page)).toHaveCount(1);
    const id = await buttons.nth(i).getAttribute("aria-controls");
    const preview = page.locator(`#${id}`);
    await expect(preview).toBeVisible();
    // Every other preview is hidden, so its links leave the tab order.
    await expect(page.locator(".tour-preview:visible")).toHaveCount(1);
    // The pin holds still under the header, and the preview sits right of the list.
    const pin = await box(page.locator(".tour-pin"));
    expect(pin.y).toBeGreaterThanOrEqual(HEADER - 1);
    expect(pin.y + pin.height).toBeLessThanOrEqual(901);
    if (pinTop === null) pinTop = pin.y;
    expect(Math.abs(pin.y - pinTop)).toBeLessThan(2);
    const shown = await box(preview);
    const step = await box(page.locator(".tour-step").nth(i));
    expect(shown.x).toBeGreaterThan(step.x + step.width);
    expect(overlaps(shown, step)).toBe(false);
  }
});

test("a part's name moves the page to its step, and the preview doesn't flicker on the way", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const buttons = tourButtons(page);
  const count = await buttons.count();
  await scrollToY(page, await stepY(page, 0));
  await expect(buttons.first()).toHaveAttribute("aria-current", "true");

  const last = count - 1;
  const target = await stepY(page, last);
  await buttons.nth(last).click();
  // Shown at once, and held while the page scrolls past the parts between.
  await expect(buttons.nth(last)).toHaveAttribute("aria-current", "true");
  const seen = new Set<string>();
  for (let n = 0; n < 8; n++) {
    seen.add((await page.locator(".tour-body").getAttribute("data-step")) ?? "");
    await page.waitForTimeout(60);
  }
  expect([...seen]).toEqual([String(last)]);
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(target);

  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(await stepY(page, 1));
  await expect(page.locator(".tour-body")).toHaveAttribute("data-step", "1");
});

test("the tour answers the keyboard: arrows, Home, and End move, Enter and Space go", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const buttons = tourButtons(page);
  const count = await buttons.count();
  await scrollToY(page, await stepY(page, 0));
  await buttons.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(buttons.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(buttons.first()).not.toHaveAttribute("aria-current", "true");
  await page.keyboard.press("End");
  await expect(buttons.nth(count - 1)).toBeFocused();
  await page.keyboard.press(" ");
  await expect(buttons.nth(count - 1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowDown");
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(buttons.nth(count - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(buttons.first()).toBeFocused();
  // Each name controls its preview.
  const id = await buttons.nth(count - 1).getAttribute("aria-controls");
  await expect(page.locator(`#${id}`)).toHaveClass(/tour-preview/);
});

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`the pinned tour never holds the scroll and nothing overlaps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator(".tour-body")).toHaveClass(/is-pinned/);
    const start = (await stepY(page, 0)) - height;
    const end = (await stepY(page, (await tourButtons(page).count()) - 1)) + height;
    let before = -1;
    for (let y = start; y <= end; y += 160) {
      await scrollToY(page, y);
      const now = await page.evaluate(() => scrollY);
      expect(now).toBeGreaterThan(before); // the page always moves on
      before = now;
      const active = page.locator(".tour-step.is-active");
      const preview = await box(active.locator(".tour-preview"));
      const words = await box(active.locator(".tour-name"));
      expect(overlaps(preview, words)).toBe(false);
      for (const name of await page.locator(".tour-name").all())
        expect(overlaps(preview, await box(name))).toBe(false);
    }
  });
}

test("on a phone the tour is a plain sequence, each part's preview under its words", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".tour-body")).not.toHaveClass(/is-pinned/);
  await expect(page.locator(".tour-anchor").first()).toBeHidden();
  await expect(shownStep(page)).toHaveCount(0);
  const steps = page.locator(".tour-step");
  const count = await steps.count();
  for (let i = 0; i < count; i++) {
    const step = steps.nth(i);
    const name = await box(step.locator(".tour-name"));
    const line = await box(step.locator(".tour-line"));
    const preview = await box(step.locator(".tour-preview"));
    await expect(step.locator(".tour-preview")).toBeVisible();
    expect(line.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(preview.y).toBeGreaterThanOrEqual(line.y + line.height - 1);
    expect(preview.x + preview.width).toBeLessThanOrEqual(391);
    if (i + 1 < count) expect((await box(steps.nth(i + 1))).y).toBeGreaterThan(preview.y + preview.height);
  }
  // A name still moves to its part.
  await tourButtons(page).nth(3).click();
  await expect.poll(async () => Math.round((await box(steps.nth(3))).y)).toBeLessThanOrEqual(HEADER + 40);
  await expect(page.locator(".tour-more a")).toHaveAttribute("href", "/features/");
});

test("without script every part of the tour shows, in order", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  for (const preview of await page.locator(".tour-preview").all()) await expect(preview).toBeVisible();
  await expect(page.locator(".tour-anchor").first()).toBeHidden();
  // The before and after is its finished state: the words marked, no replay to offer.
  await expect(page.locator(".pair .replay")).toBeHidden();
  await expect(page.locator(".pair .kept-mark")).toBeVisible();
  await context.close();
});

test("the before and after files the note once in view, holds off screen, and rests marked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const pair = page.locator("[data-filing]");
  await expect(pair).toHaveAttribute("data-state", "idle");
  // The whole comparison, headline to caption, fits in one window under the header.
  const head = await box(page.locator("#two-kinds .section-head"));
  const caption = await box(pair.locator("figcaption"));
  expect(caption.y + caption.height - head.y).toBeLessThanOrEqual(900 - HEADER);

  await pair.scrollIntoViewIfNeeded();
  await expect(pair).toHaveAttribute("data-state", "playing");
  // Mid-play the words are whole on both sides: the play hides characters, never drops them.
  const bodies = pair.locator(".body");
  expect(await bodies.nth(0).textContent()).toBe(await bodies.nth(1).textContent());

  // Off screen the clock stops.
  await scrollToY(page, 0);
  await page.waitForTimeout(150);
  const typed = () =>
    pair
      .locator("[data-typed] > span")
      .first()
      .evaluate((s) => s.textContent?.length ?? 0);
  const held = await typed();
  await page.waitForTimeout(800);
  expect(await typed()).toBe(held);
  await expect(pair).toHaveAttribute("data-state", "playing");

  await pair.scrollIntoViewIfNeeded();
  await expect(pair).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  for (const row of await pair.locator(".added .row").all()) await expect(row).toHaveCSS("opacity", "1");
  await expect(pair.locator(".kept")).toHaveCSS("transform", "none");
  await expect(pair.locator(".kept .check")).toHaveCSS("opacity", "1");
  expect(await bodies.nth(0).textContent()).toBe(await bodies.nth(1).textContent());

  // Replay plays it again from the start, and it rests the same way.
  const replay = pair.getByRole("button", { name: "Replay" });
  await expect(replay).toBeVisible();
  expect((await box(replay)).height).toBeGreaterThanOrEqual(44);
  await replay.click();
  await expect(pair).toHaveAttribute("data-state", "playing");
  await expect(pair.locator(".added .row").first()).toHaveCSS("opacity", "0");
  await expect(pair).toHaveAttribute("data-state", "done", { timeout: 10_000 });
});

test("the closing banner: two lines, one short line, the way in, and art clear of the words", async ({
  page,
}) => {
  await page.goto("/");
  const banner = page.locator("#start");
  await expect(banner.locator("h2 .strong")).toHaveText("Start with one note.");
  await expect(banner.locator("h2 .soft")).toHaveText("It stays in your folder.");
  await expect(banner.locator(".line")).toHaveText("Free, with no account to make.");
  await expect(banner.locator(".action-try")).toHaveText("Try now");
  await expect(banner.locator(".art")).toHaveAttribute("aria-hidden", "true");
  // The strong line and the muted line read in two colours.
  const [strong, soft] = await Promise.all(
    [".strong", ".soft"].map((part) =>
      banner.locator(`h2 ${part}`).evaluate((el) => getComputedStyle(el).color),
    ),
  );
  expect(strong).not.toBe(soft);

  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await banner.scrollIntoViewIfNeeded();
    const quokka = await box(banner.locator(".art img"));
    for (const words of ["h2", ".line", ".site-actions"]) {
      expect(overlaps(quokka, await box(banner.locator(words))), `${words} at ${width}px`).toBe(false);
    }
  }
});

test("under reduced motion the cards, tour, before and after, and banner rest in their finished state", async ({
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#start").scrollIntoViewIfNeeded();
  for (const sheet of await page.locator("#start .sheet").all())
    await expect(sheet).toHaveCSS("opacity", "1");

  // The before and after never plays: no clock, no Replay, the words marked.
  const pair = page.locator("[data-filing]");
  await pair.scrollIntoViewIfNeeded();
  await expect(pair).not.toHaveAttribute("data-state", /.+/);
  await expect(pair.locator(".replay")).toBeHidden();
  await expect(pair.locator(".kept .check")).toHaveCSS("opacity", "1");

  // The tour still steps with the scroll, but swaps its preview at once: no crossfade.
  await expect(page.locator(".tour-body")).toHaveClass(/is-pinned/);
  await scrollToY(page, await stepY(page, 1));
  await expect(tourButtons(page).nth(1)).toHaveAttribute("aria-current", "true");
  const preview = page.locator(".tour-step.is-active .tour-preview");
  // Base.astro's reduced-motion rule leaves every transition at a hair above zero.
  const duration = await preview.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(duration).toBeLessThan(0.01);
  await expect(preview).toHaveCSS("opacity", "1");
  await tourButtons(page).nth(2).click();
  await expect(tourButtons(page).nth(2)).toHaveAttribute("aria-current", "true");
  const running = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => a.playState === "running" && a instanceof CSSAnimation).length,
  );
  expect(running).toBe(0);
  await context.close();
});
