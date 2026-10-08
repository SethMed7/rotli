// The landing's layout of 2026-10-05 (docs/design/landing-layout-2026-10-05.md): the section
// order and its grounds, the Overview's three steps (write in your view, the Librarian files it
// in the vault, ask; one at a time following the scroll since 2026-10-08) with their drawn pictures, the LLM wiki link, and the one link to
// /features/, the before and after's filing play (the File step's picture: it plays once in
// view, holds off screen, rests marked, and replays), and the closing banner, whose art never
// sits on its words. The "A closer look." tour was removed on 2026-10-06; Rotli Web and the
// Helper are answered in the FAQ while WEB_APP_ENABLED, which this suite's build leaves off, so
// that check is conditional. The banner's one way in is "Download free", to /download/.
import { expect, test, type Locator, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const HEADER = 68;
const scrollToY = (page: Page, y: number) =>
  page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);

test("the sections run in order, alternating plain and warm grounds", async ({ page }) => {
  await page.goto("/");
  const ids = await page
    .locator("main > section")
    .evaluateAll((sections) => sections.map((s) => s.id || s.classList[0]));
  // TwoKinds merged into the Overview and the tour was removed (both 2026-10-06), so the theme
  // studio is warm again: the grounds alternate up to the privacy night.
  expect(ids).toEqual(["hero", "waiting", "features", "personal", "privacy", "faq", "start"]);
  await expect(page.locator("#two-kinds")).toHaveCount(0);
  await expect(page.locator("#tour")).toHaveCount(0);
  const warm = await page
    .locator("main > section")
    .evaluateAll((sections) => sections.map((s) => s.classList.contains("band-warm")));
  expect(warm).toEqual([false, true, false, true, false, false, false]);
});

// Scroll the page so the pinned story is `share` of the way through its runway.
const scrollStory = (page: Page, share: number) =>
  page.evaluate((s) => {
    const pin = document.querySelector<HTMLElement>("[data-story-pin]")!;
    const story = document.querySelector<HTMLElement>("[data-story]")!;
    const runway = document.querySelector<HTMLElement>("[data-story-runway]")!;
    const stick = parseFloat(getComputedStyle(story).top);
    const top = pin.getBoundingClientRect().top + window.scrollY - stick;
    window.scrollTo({ top: top + s * runway.offsetHeight, behavior: "instant" });
  }, share);
const openStep = (page: Page) =>
  page.locator(".story-tab[aria-current='step']").evaluate((tab) => tab.getAttribute("aria-controls"));

test("one story in three steps: write in your view, the Librarian files it, ask", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const section = page.locator("#features");
  await expect(section.locator("h2")).toHaveText("Write it down. rotli puts it away.");
  await expect(section.locator(".section-lede")).toContainText("lives once, in your vault");
  // The steps are listed by their headings; each picture carries its heading and sentence too.
  const tabs = section.locator(".story-tab");
  await expect(tabs.locator(".story-title")).toHaveText([
    "Write in your view",
    "The Librarian files it",
    "Ask, and AI goes straight to it",
  ]);
  const slides = section.locator(".story-slide");
  await expect(slides.locator("h3")).toHaveText([
    "Write in your view",
    "The Librarian files it",
    "Ask, and AI goes straight to it",
  ]);
  // The product's own words, and only what its contracts say.
  await expect(slides.nth(0)).toContainText("never copies them");
  await expect(slides.nth(1)).toContainText("When it’s on");
  await expect(slides.nth(1)).toContainText("never changes your words");
  await expect(slides.nth(2)).toContainText("on your computer");
  await expect(slides.nth(2)).toContainText("only the few notes that matter");
  // Each picture has one quokka; the pictures are HTML, not screenshots.
  for (const slide of await slides.all()) {
    await expect(slide.locator(".quokka")).toHaveCount(1);
    await expect(slide.locator("img:not(.quokka)")).toHaveCount(0);
  }
  await expect(slides.nth(0).locator('[role="img"][aria-label*="vault"]')).toHaveCount(1);
  await expect(slides.nth(2).locator('[role="img"][aria-label*="on this computer"]')).toHaveCount(1);
  // The list sits left of the pictures on a laptop.
  const list = await box(section.locator(".story-tabs"));
  const track = await box(section.locator(".story-track"));
  expect(track.x).toBeGreaterThanOrEqual(list.x + list.width);
});

test("the steps follow the scroll: the story pins, and each third of the way is one step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const story = page.locator("#features .story");
  expect(await openStep(page)).toBe("story-write");
  // Only the open picture takes focus and clicks.
  await expect(page.locator("#story-file")).toHaveJSProperty("inert", true);
  for (const [share, step] of [
    [0.1, "story-write"],
    [0.5, "story-file"],
    [0.9, "story-ask"],
    [0.5, "story-file"],
    [0.05, "story-write"],
  ] as const) {
    await scrollStory(page, share);
    await expect.poll(() => openStep(page)).toBe(step);
    // Pinned: the story holds its place under the header the whole way (once its reveal settles).
    const stick = parseFloat(await story.evaluate((s) => getComputedStyle(s).top));
    await expect.poll(async () => Math.abs((await box(story)).y - stick)).toBeLessThanOrEqual(2);
  }
  await expect(page.locator("#story-write")).toHaveJSProperty("inert", false);
  // A step's name scrolls the page to it.
  await page.locator(".story-tab", { hasText: "Ask, and AI goes straight to it" }).click();
  await expect.poll(() => openStep(page)).toBe("story-ask");
  // Past the runway the page goes on, and nothing scrolls sideways.
  await scrollStory(page, 1.4);
  expect((await box(story)).y).toBeLessThan(parseFloat(await story.evaluate((s) => getComputedStyle(s).top)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the story lines up: no numbers, no cards, one picture width, the open picture home in the track", async ({
  page,
}) => {
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const story = page.locator("#features .story");
    await expect(story.locator(".step-number")).toHaveCount(0);
    const widths = new Set<number>();
    for (const [index, id] of ["story-write", "story-file", "story-ask"].entries()) {
      await scrollStory(page, (index + 0.5) / 3);
      await expect.poll(() => openStep(page)).toBe(id);
      const figure = story.locator(`#${id} > figure`);
      const track = await box(story.locator(".story-track"));
      await expect.poll(async () => Math.abs((await box(figure)).x - track.x)).toBeLessThanOrEqual(13); // slid home (the track's bleed is 0.75rem)
      const picture = await box(figure);
      widths.add(Math.round(picture.width));
      const label = await box(figure.locator(".side-label, .state-label").first());
      expect(Math.abs(label.y - picture.y), `label at the picture's top at ${width}`).toBeLessThanOrEqual(4);
      // No card: nothing inside the picture draws a box around its content.
      const boxed = await figure.evaluate(
        (root) =>
          [root, ...root.querySelectorAll("*")].filter((el) => {
            const style = getComputedStyle(el);
            return (
              ["Top", "Right", "Bottom", "Left"].every(
                (side) => style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none",
              ) && el.getBoundingClientRect().height > 60
            );
          }).length,
      );
      expect(boxed, `no boxed panels at ${width}`).toBe(0);
    }
    expect(widths.size, `one picture width at ${width}`).toBe(1);
  }
});

test("on a short window the story stacks instead of pinning", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/");
  await expect(page.locator(".story-tabs")).toBeHidden();
  await expect(page.locator(".story-slide h3").first()).toBeVisible();
  for (const slide of await page.locator(".story-slide").all())
    await expect(slide).toHaveJSProperty("inert", false);
});

test("the view and the vault: the same note on both sides, joined by a dotted line", async ({ page }) => {
  await page.goto("/");
  const where = page.locator(".where");
  await expect(where.locator(".here")).toHaveText(["Call with Dana", "dana-call.md"]);
  await expect(where.locator(".link-line")).toHaveText("same file");
  await expect(where.locator(".side-label")).toHaveText(["In your view", "In your vault"]);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await where.scrollIntoViewIfNeeded();
    const view = await box(where.locator(".here").nth(0));
    const vault = await box(where.locator(".here").nth(1));
    const line = await box(where.locator(".link-line"));
    if (width >= 600) {
      // Side by side: the line runs level with both marked rows, from one to the other.
      const middle = (b: Box) => b.y + b.height / 2;
      expect(Math.abs(middle(view) - middle(vault)), `rows level at ${width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(middle(line) - middle(view)), `line level at ${width}`).toBeLessThanOrEqual(3);
      // The vault's row sits at its depth, as in the app; the dots carry on across the indent.
      const reach = await box(where.locator(".reach"));
      expect(line.x).toBeLessThanOrEqual(view.x + view.width + 1);
      expect(reach.x).toBeLessThanOrEqual(line.x + line.width + 1);
      expect(reach.x + reach.width).toBeGreaterThanOrEqual(vault.x - 1);
    } else {
      // Stacked: the view above, the vault below, the line running down between them.
      expect(vault.y).toBeGreaterThan(view.y + view.height);
      expect(line.height).toBeGreaterThan(line.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("what is an LLM wiki: one link under the lede, to the term's source", async ({ page }) => {
  await page.goto("/");
  const head = page.locator("#features .section-head");
  const source = head.getByRole("link", { name: "What is an LLM wiki?" });
  await expect(source).toHaveAttribute(
    "href",
    "https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f",
  );
  await expect(source).toHaveAttribute("rel", /noopener/);
  // The two-sentence aside it replaced is gone (the owner, 2026-10-08).
  await expect(page.locator("#features .llm-wiki")).toHaveCount(0);
});

test("the story is the section's last word, and the FAQ points to Rotli Web", async ({ page }) => {
  await page.goto("/");
  // No "See every feature" (Features is in the header) and no trailing guide link (the owner,
  // 2026-10-07): the story is the section's last word.
  const section = page.locator("#features");
  await expect(section.getByRole("link", { name: "See every feature" })).toHaveCount(0);
  await expect(section.locator('a[href="/blog/getting-started/"]')).toHaveCount(0);
  await expect(section.locator(".wrap > :last-child")).toHaveClass(/story-pin/);
  // Rotli Web and the Helper: one FAQ answer with its two links, only while WEB_APP_ENABLED.
  // The vault, and how to start one, is a FAQ answer that leads to the guide (2026-10-07).
  const vault = page.locator(".faq-list details", { hasText: "What is a vault, and how do I start one?" });
  await vault.locator("summary").click();
  await expect(vault).toContainText("the folder your notes live in");
  await expect(vault.getByRole("link", { name: "Getting started" })).toHaveAttribute(
    "href",
    "/blog/getting-started/",
  );
  const browser = page.locator(".faq-list details", { hasText: "Can I use rotli in my browser?" });
  if ((await browser.count()) > 0) {
    await browser.locator("summary").click();
    await expect(browser).toContainText("your notes stay in a folder on your computer");
    await expect(browser.getByRole("link", { name: /What is Rotli Helper/ })).toHaveAttribute(
      "href",
      "/blog/rotli-helper/",
    );
    await expect(browser.getByRole("link", { name: /Why it goes through Terminal/ })).toHaveAttribute(
      "href",
      "/blog/rotli-web-and-your-mac/",
    );
  }
});

test("without script the before and after is its finished state", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  // The words marked, no replay to offer.
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
  // The whole comparison, from its labels to its caption, fits in one window under the header
  // (since 2026-10-06 it is the File step's picture; the three-step section is taller).
  const top = await box(pair);
  const caption = await box(pair.locator("figcaption"));
  expect(caption.y + caption.height - top.y).toBeLessThanOrEqual(900 - HEADER);

  await scrollStory(page, 0.5);
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

  await scrollStory(page, 0.5);
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
  await expect(banner.locator(".action-try")).toHaveText("Download free");
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

test("under reduced motion the before and after and the banner rest in their finished state", async ({
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
  await scrollStory(page, 0.5);
  await expect(pair).not.toHaveAttribute("data-state", /.+/);
  await expect(pair.locator(".replay")).toBeHidden();
  await expect(pair.locator(".kept .check")).toHaveCSS("opacity", "1");

  const running = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => a.playState === "running" && a instanceof CSSAnimation).length,
  );
  expect(running).toBe(0);
  await context.close();
});
