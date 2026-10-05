// The landing's layout of 2026-10-05 (docs/design/landing-layout-2026-10-05.md): the section
// order and its grounds, the three cards with their drawn pictures, the tour (a disclosure list
// with one part open, by mouse and by keyboard, its preview beside the list on wide screens and
// inside the open part on phones), and the closing banner, whose art never sits on its words.
// This suite's build has WEB_APP_ENABLED off, so the tour has five parts and the banner offers
// only the download; each check holds with the sixth part and the browser button too.
import { expect, test, type Locator, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tourButtons = (page: Page) => page.locator(".tour-name button");

test("the sections run in order, alternating plain and warm grounds", async ({ page }) => {
  await page.goto("/");
  const ids = await page
    .locator("main > section")
    .evaluateAll((sections) => sections.map((s) => s.id || s.classList[0]));
  expect(ids).toEqual([
    "hero",
    "features",
    "waiting",
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

test("the tour opens one part at a time by mouse, and its preview keeps one height", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const buttons = tourButtons(page);
  const count = await buttons.count();
  expect([5, 6]).toContain(count);
  await expect(buttons.first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tour-panel:not([hidden])")).toHaveCount(1);
  const body = page.locator(".tour-body");
  await body.scrollIntoViewIfNeeded();
  const height = (await box(body)).height;

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('.tour-name button[aria-expanded="true"]')).toHaveCount(1);
    const panel = page.locator(`#${await button.getAttribute("aria-controls")}`);
    await expect(panel).toBeVisible();
    await expect(page.locator(".tour-panel:not([hidden])")).toHaveCount(1);
    // The preview fills the right column, clear of the list.
    const preview = await box(panel.locator(".tour-preview"));
    expect(preview.x).toBeGreaterThan((await box(button)).x + (await box(button)).width);
    expect(Math.abs((await box(body)).height - height)).toBeLessThan(2);
  }

  // Pressing the open part again leaves it open, so the preview is never empty.
  const last = buttons.nth(count - 1);
  await last.click();
  await expect(last).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tour-panel:not([hidden])")).toHaveCount(1);
});

test("the tour answers the keyboard: arrows, Home, and End move, Enter and Space open", async ({ page }) => {
  await page.goto("/");
  const buttons = tourButtons(page);
  const count = await buttons.count();
  await buttons.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(buttons.first()).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("End");
  await expect(buttons.nth(count - 1)).toBeFocused();
  await page.keyboard.press(" ");
  await expect(buttons.nth(count - 1)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(buttons.nth(count - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(buttons.first()).toBeFocused();
  // The heading names the region it controls.
  const panel = page.locator(`#${await buttons.nth(count - 1).getAttribute("aria-controls")}`);
  await expect(panel).toHaveRole("region");
  await expect(panel).toHaveAccessibleName(((await buttons.nth(count - 1).textContent()) ?? "").trim());
});

test("on a phone the tour is a stacked accordion with the preview inside the open part", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const buttons = tourButtons(page);
  await buttons.nth(2).click();
  const item = page.locator(".tour-item").nth(2);
  const preview = await box(item.locator(".tour-preview"));
  const button = await box(buttons.nth(2));
  const itemBox = await box(item);
  expect(preview.y).toBeGreaterThan(button.y + button.height);
  expect(preview.x).toBeGreaterThanOrEqual(itemBox.x);
  expect(preview.x + preview.width).toBeLessThanOrEqual(itemBox.x + itemBox.width + 1);
  expect((await box(buttons.nth(3))).y).toBeGreaterThan(preview.y + preview.height);
  await expect(page.locator(".tour-more a")).toHaveAttribute("href", "/features/");
});

test("without script every part of the tour is open and readable", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  const panels = page.locator(".tour-panel");
  for (const panel of await panels.all()) await expect(panel).toBeVisible();
  await context.close();
});

test("the closing banner: two lines, one short line, the way in, and art clear of the words", async ({
  page,
}) => {
  await page.goto("/");
  const banner = page.locator("#start");
  await expect(banner.locator("h2 .strong")).toHaveText("Start with one note.");
  await expect(banner.locator("h2 .soft")).toHaveText("It stays in your folder.");
  await expect(banner.locator(".line")).toHaveText("Free, with no account to make.");
  await expect(banner.locator(".action-download")).toHaveCount(1);
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

test("under reduced motion the cards, tour, and banner rest in their finished state", async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#start").scrollIntoViewIfNeeded();
  for (const sheet of await page.locator("#start .sheet").all())
    await expect(sheet).toHaveCSS("opacity", "1");
  await tourButtons(page).nth(1).click();
  await expect(tourButtons(page).nth(1)).toHaveAttribute("aria-expanded", "true");
  const running = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => a.playState === "running" && a instanceof CSSAnimation).length,
  );
  expect(running).toBe(0);
  await context.close();
});
