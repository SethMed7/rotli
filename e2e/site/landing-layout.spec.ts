// The landing's layout of 2026-10-05 (docs/design/landing-layout-2026-10-05.md): the section
// order and its grounds, the Overview's three steps (write in your view, the Librarian files it
// in the vault, ask; tabs over one sliding track since 2026-10-08) with their drawn pictures, the LLM wiki aside, and the one link to
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

test("one story in three steps: write in your view, the Librarian files it, ask", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const section = page.locator("#features");
  await expect(section.locator("h2")).toHaveText("Write it down. rotli puts it away.");
  await expect(section.locator(".section-lede")).toContainText("lives once, in your vault");
  // The steps are tabs, named by their headings and described by their one sentence.
  const tabs = section.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  for (const [index, name] of [
    "Write in your view",
    "The Librarian files it",
    "Ask, and AI goes straight to it",
  ].entries())
    await expect(tabs.nth(index)).toHaveAccessibleName(name);
  // The product's own words, and only what its contracts say.
  await expect(tabs.nth(0)).toHaveAccessibleDescription(/never copies them/);
  await expect(tabs.nth(1)).toHaveAccessibleDescription(/When it’s on/);
  await expect(tabs.nth(1)).toHaveAccessibleDescription(/never changes your words/);
  await expect(tabs.nth(2)).toHaveAccessibleDescription(/on your computer/);
  await expect(tabs.nth(2)).toHaveAccessibleDescription(/only the few notes that matter/);
  // Each picture has one quokka; the pictures are HTML, not screenshots.
  const panels = section.getByRole("tabpanel", { includeHidden: true });
  await expect(panels).toHaveCount(3);
  for (const panel of await panels.all()) {
    await expect(panel.locator(".quokka")).toHaveCount(1);
    await expect(panel.locator("img:not(.quokka)")).toHaveCount(0);
  }
  await expect(panels.nth(0).getByRole("img")).toHaveAttribute("aria-label", /view.*vault/);
  await expect(panels.nth(2).locator('[role="img"][aria-label*="on this computer"]')).toHaveCount(1);
  // The tabs sit left of the pictures on a laptop.
  const list = await box(section.getByRole("tablist"));
  const track = await box(section.locator("[data-story-track]"));
  expect(track.x).toBeGreaterThanOrEqual(list.x + list.width);
});

test("one step at a time: it plays through once on its own, and a tab, a key, or a swipe takes over", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto("/");
  const story = page.locator("#features .story");
  const tabs = story.getByRole("tab");
  const open = () =>
    story.getByRole("tab", { selected: true }).evaluate((tab) => tab.getAttribute("aria-controls"));
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  // Only the open picture takes focus and clicks.
  await expect(story.locator("#story-file")).toHaveJSProperty("inert", true);
  await story.scrollIntoViewIfNeeded();
  await expect(story).toHaveAttribute("data-cycle", "auto");
  await page.clock.runFor(6600);
  await expect.poll(open).toBe("story-file");
  await expect(story.locator("#story-write")).toHaveJSProperty("inert", true);
  await page.clock.runFor(10_100);
  await expect.poll(open).toBe("story-ask");
  // Once through, then it rests on the last step.
  await page.clock.runFor(8100);
  await expect(story).toHaveAttribute("data-cycle", "off");
  await page.clock.runFor(30_000);
  expect(await open()).toBe("story-ask");

  // A tab is the visitor's choice, kept.
  await tabs.nth(0).click();
  await expect(story).toHaveAttribute("data-cycle", "pinned");
  await expect.poll(open).toBe("story-write");
  // The arrow keys move between tabs.
  await tabs.nth(0).press("ArrowDown");
  await expect.poll(open).toBe("story-file");
  await expect(tabs.nth(1)).toBeFocused();
  await tabs.nth(1).press("End");
  await expect.poll(open).toBe("story-ask");
  // A swipe of the track opens the picture it lands on.
  await story.locator("[data-story-track]").evaluate((track) => {
    track.scrollTo({ left: 0, behavior: "instant" });
  });
  await page.clock.runFor(300);
  await expect.poll(open).toBe("story-write");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("under reduced motion the story never plays on its own, and the tabs still switch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto("/");
  const story = page.locator("#features .story");
  await story.scrollIntoViewIfNeeded();
  await page.clock.runFor(30_000);
  await expect(story).toHaveAttribute("data-cycle", "off");
  await expect(story.getByRole("tab").nth(0)).toHaveAttribute("aria-selected", "true");
  await story.getByRole("tab").nth(2).click();
  await expect(story.locator("#story-ask")).toHaveAttribute("data-active", "");
  await context.close();
});

test("the story lines up: no numbers, no cards, one picture width, the open heading level with its labels", async ({
  page,
}) => {
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const story = page.locator("#features .story");
    await expect(story.locator(".step-number")).toHaveCount(0);
    const widths = new Set<number>();
    for (const [index, tab] of (await story.getByRole("tab").all()).entries()) {
      await tab.click();
      const panel = story.locator(`#${await tab.getAttribute("aria-controls")}`);
      await expect(panel).toHaveAttribute("data-active", "");
      const figure = panel.locator("> figure");
      await expect
        .poll(async () =>
          Math.round((await box(figure)).x - (await box(story.locator("[data-story-track]"))).x),
        )
        .toBeLessThanOrEqual(13); // slid home (the track's bleed is 0.75rem)
      const picture = await box(figure);
      widths.add(Math.round(picture.width));
      const label = await box(figure.locator(".side-label, .state-label").first());
      expect(Math.abs(label.y - picture.y), `label at the picture's top at ${width}`).toBeLessThanOrEqual(4);
      // The tabs start level with the picture's head.
      if (index === 0) {
        const heading = await box(tab.locator(".story-title"));
        expect(Math.abs(heading.y - picture.y), `first heading level at ${width}`).toBeLessThanOrEqual(24);
      }
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

test("what is an LLM wiki: two sentences beside the story, linked to the term's source", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("#features .llm-wiki");
  await expect(aside.locator("h3")).toHaveText("What is an LLM wiki?");
  const source = aside.getByRole("link", { name: "LLM Wiki note" });
  await expect(source).toHaveAttribute(
    "href",
    "https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f",
  );
  await expect(source).toHaveAttribute("rel", /noopener/);
  await expect(aside).toContainText("Andrej Karpathy");
});

test("the story ends on the LLM wiki aside, and the FAQ points to Rotli Web", async ({ page }) => {
  await page.goto("/");
  // No "See every feature" (Features is in the header) and no trailing guide link (the owner,
  // 2026-10-07): the aside is the section's last word.
  const section = page.locator("#features");
  await expect(section.getByRole("link", { name: "See every feature" })).toHaveCount(0);
  await expect(section.locator('a[href="/blog/getting-started/"]')).toHaveCount(0);
  await expect(section.locator(".wrap > :last-child")).toHaveClass(/llm-wiki/);
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
  await pair.scrollIntoViewIfNeeded();
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
