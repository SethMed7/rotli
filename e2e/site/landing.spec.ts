// The landing page: what rotli is, its two buttons ("Our privacy promise" and "Download free"; where it runs is
// /download/'s to say), the header's matching button and plain, gold GitHub star count, the short stat band, the cardless
// before/after, the close after the questions, and the privacy passage that takes the whole page, header included, into
// Ocean Dark and back out in either direction.
import { expect, test, type Page } from "@playwright/test";

const passage = (page: Page) => page.evaluate(() => document.documentElement.dataset.passage ?? "");
const scrollToPrivacy = (page: Page, share: number) =>
  page.evaluate((s) => {
    const band = document.getElementById("privacy")!;
    const top = band.getBoundingClientRect().top + window.scrollY;
    // The page scrolls smoothly by default; jump, so each step lands before it is checked.
    window.scrollTo({ top: top + band.offsetHeight * s - window.innerHeight / 2, behavior: "instant" });
  }, share);

test("the hero says what rotli is and costs, with two buttons, and no platform line", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hero");
  const lede = hero.locator(".hero-lede");
  await expect(lede).toContainText("a free workspace built on plain Markdown files");
  await expect(lede).toContainText("Docs and Sheets (beta)");
  await expect(lede).not.toContainText("Mac");
  await expect(hero.locator(".hero-cost")).toHaveText("No account. Works offline.");
  // Where rotli runs is the download page's (and the FAQ's) to say (the owner, 2026-10-05).
  await expect(hero).not.toContainText("Windows");
  await expect(page.locator("#start")).not.toContainText("Windows");
  // Two buttons, the privacy promise first (the owner, 2026-10-06: "Privacy promise goes on the
  // left"), outlined, with its lock; then "Download free" to the page that offers the Mac app and
  // Rotli Web (no direct DMG). The old one-line pointer is gone.
  const actions = hero.locator(".site-actions a");
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveText("Our privacy promise");
  await expect(actions.nth(0)).toHaveAttribute("href", "/privacy/#promise");
  await expect(actions.nth(0)).toHaveClass(/\bsecondary\b/);
  await expect(actions.nth(0).locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(actions.nth(1)).toHaveText("Download free");
  await expect(actions.nth(1)).toHaveAttribute("href", "/download/");
  await expect(actions.nth(1)).toHaveClass(/\bprimary\b/);
  await expect(page.locator("main a[href$='.dmg']")).toHaveCount(0);
  await expect(hero.locator(".hero-promise b, .promise-text")).toHaveCount(0);
});

test("the hero's two buttons share one size: the promise left of the download, stacked in that order on a phone", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const buttons = page.locator(".hero .site-actions .button");
    const look = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          height: Math.round(box.height),
          radius: style.borderRadius,
          size: style.fontSize,
          weight: style.fontWeight,
          box: { x: box.x, y: box.y, width: box.width, bottom: box.bottom },
        };
      }),
    );
    expect(look).toHaveLength(2);
    // The markup's order is the order seen: the promise, then the download.
    const [secondary, primary] = look as [(typeof look)[0], (typeof look)[0]];
    expect(secondary.height, `height at ${width}`).toBe(primary.height);
    expect(secondary.radius).toBe(primary.radius);
    expect(secondary.size).toBe(primary.size);
    expect(secondary.weight).toBe(primary.weight);
    expect(primary.height).toBeGreaterThanOrEqual(44);
    if (width <= 520) {
      // Stacked in the same order (one order for sight, keyboard, and screen readers), each the
      // column's full width.
      expect(primary.box.y).toBeGreaterThanOrEqual(secondary.box.bottom);
      expect(Math.abs(secondary.box.width - primary.box.width)).toBeLessThanOrEqual(1);
      const column = await page.locator(".hero-copy").evaluate((el) => el.getBoundingClientRect().width);
      expect(primary.box.width).toBeGreaterThanOrEqual(column - 1);
    } else {
      expect(Math.abs(secondary.box.y - primary.box.y)).toBeLessThanOrEqual(1);
      expect(primary.box.x).toBeGreaterThan(secondary.box.x + secondary.box.width);
    }
    // Both, and the quiet line under them, inside the first window.
    expect(look.every((button) => button.box.bottom <= 900)).toBe(true);
    const meta = (await page.locator(".hero-meta").boundingBox())!;
    expect(meta.y).toBeGreaterThanOrEqual(Math.max(primary.box.bottom, secondary.box.bottom));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("the privacy promise button and the night band lead to the same place", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#privacy .privacy-link")).toHaveAttribute("href", "/privacy/#promise");
  // Following it lands on the promise, under the header.
  await page.locator(".hero .hero-promise").click();
  await expect(page).toHaveURL(/\/privacy\/#promise$/);
  await expect(page.locator("#promise")).toBeInViewport();
});

test("the header's button matches the hero's: the same words, place, and style family", async ({ page }) => {
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const hero = page.locator(".hero .site-actions .button.primary");
    const header = page.locator(".site-header .header-download");
    await expect(header).toBeVisible();
    await expect(header).toHaveText((await hero.textContent())!.trim());
    await expect(header).toHaveText("Download free");
    await expect(header).toHaveAttribute("href", (await hero.getAttribute("href"))!);
    await expect(header).toHaveClass(/\bbutton\b.*\bprimary\b/);
    const [a, b] = await Promise.all(
      [hero, header].map((el) =>
        el.evaluate((node) => {
          const style = getComputedStyle(node);
          return [style.backgroundColor, style.color, style.fontWeight];
        }),
      ),
    );
    expect(b).toEqual(a);
  }
  // Every primary call to action on the page says the same.
  await expect(page.locator("#start .action-try")).toHaveText("Download free");
  // On a phone the button waits in Menu, saying the same.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".site-header .header-download")).toBeHidden();
  await page.locator(".nav-menu summary").click();
  await expect(page.locator(".nav-menu-panel > .button")).toHaveText("Download free");
});

test("GitHub with its star count sits up top, read at build time, never fetched by the browser", async ({
  page,
}) => {
  const github: string[] = [];
  page.on("request", (request) => {
    if (/github/i.test(new URL(request.url()).hostname)) github.push(request.url());
  });
  type Box = { left: number; right: number; top: number; bottom: number };
  for (const width of [320, 390, 561, 768, 1024, 1081, 1150, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const link = page.locator(".site-header .github-link");
    if (width > 560) {
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", "https://github.com/SethMed7/rotli");
      // Its name says what it is and the count (this build's SITE_GITHUB_STARS=1234, formatted
      // short); what shows is the mark, a star, and the count.
      await expect(link).toHaveAccessibleName("Star rotli on GitHub, 1.2k stars");
      await expect(link.locator(".github-count")).toHaveText("1.2k");
      for (const glyph of await link.locator("svg").all())
        await expect(glyph).toHaveAttribute("aria-hidden", "true");
      await expect(link.locator(".github-star")).toBeVisible();
      // Left of the button, with room between them, on its middle line.
      const [star, button] = await Promise.all([
        link.boundingBox(),
        page.locator(".header-download").boundingBox(),
      ]);
      expect(button!.x - (star!.x + star!.width)).toBeGreaterThanOrEqual(12);
      expect(Math.abs(star!.y + star!.height / 2 - (button!.y + button!.height / 2))).toBeLessThanOrEqual(1);
    } else {
      await expect(link).toBeHidden();
    }
    // Nothing in the bar overlaps, and nothing runs off the side.
    const boxes = await page
      .locator(
        ".site-header .brand, .site-header .primary-nav > *, .site-header .github-link, .site-header .header-download, .site-header .nav-menu > summary",
      )
      .evaluateAll((els) =>
        els
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => el.getBoundingClientRect().toJSON() as Box),
      );
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        expect(a.right <= b.left + 0.5 || b.right <= a.left + 0.5, `header overlap at ${width}`).toBe(true);
      }),
    );
    expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(width);
  }
  // On a phone it waits in Menu, with its count.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".nav-menu summary").click();
  const entry = page.locator(".nav-menu-panel .menu-github");
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAccessibleName("Star rotli on GitHub, 1.2k stars");
  // No script, frame, or image from GitHub: the count is text in the page.
  await expect(page.locator("script[src*='github'], iframe, img[src*='github']")).toHaveCount(0);
  expect(github).toEqual([]);
});

// WCAG 2 contrast between two computed rgb() colours.
const contrastOf = (a: string, b: string) => {
  const lum = (css: string) => {
    const [r, g, b] = css
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((n) => Number(n) / 255);
    const c = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("the GitHub link is plain: no box, the star and count in a gold that reads, a focus ring and a hover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const link = page.locator(".site-header .github-link");
  const look = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    return { border: style.borderTopStyle, background: style.backgroundColor };
  });
  expect(look.border).toBe("none");
  expect(look.background).toBe("rgba(0, 0, 0, 0)");
  // The star and the count share one gold; the mark stays in ink.
  const [count, star, mark, ground] = await Promise.all([
    link.locator(".github-count").evaluate((el) => getComputedStyle(el).color),
    link.locator(".github-star").evaluate((el) => getComputedStyle(el).color),
    link.locator(".github-mark").evaluate((el) => getComputedStyle(el).color),
    page.locator(".site-header-bar").evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(star).toBe(count);
  expect(mark).not.toBe(count);
  expect(contrastOf(count, ground)).toBeGreaterThanOrEqual(4.5);
  // Hover underlines the count; the keyboard gets the ring.
  const underline = () =>
    link.locator(".github-count").evaluate((el) => getComputedStyle(el).textDecorationColor);
  const resting = await underline();
  await link.hover();
  await expect.poll(underline).not.toBe(resting);
  await page.mouse.move(0, 400);
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS("outline-style", "solid");
});

test("Rotli Web is a question, not a chapter, and the page closes on one banner after the questions", async ({
  page,
}) => {
  await page.goto("/");
  // The ways-in chapter folded into the tour (2026-10-05), and the tour was removed
  // (2026-10-06): Rotli Web and the Helper are now one FAQ answer, only while WEB_APP_ENABLED,
  // and this suite's build may leave it off.
  await expect(page.locator("#web-title")).toHaveCount(0);
  await expect(page.locator("#tour")).toHaveCount(0);
  const web = page.locator(".faq-list summary", { hasText: "Can I use rotli in my browser?" });
  expect(await web.count()).toBeLessThanOrEqual(1);
  await expect(page.locator("#final-title")).toHaveCount(0);
  const sections = page.locator("main > section");
  await expect(sections.last()).toHaveId("start");
  await expect(sections.nth((await sections.count()) - 2)).toHaveId("faq");
});

test("the before and after are open columns: the same words, with added lines marked", async ({ page }) => {
  await page.goto("/");
  const pair = page.locator(".pair");
  await expect(pair.locator(".paper")).toHaveCount(0);
  const bodies = pair.locator(".body");
  await expect(bodies).toHaveCount(2);
  expect(await bodies.nth(0).textContent()).toBe(await bodies.nth(1).textContent());
  await expect(pair.locator(".added .row")).toHaveCount(6);
  await expect(pair.locator(".added")).toContainText("area: Clients");
  await expect(pair.locator(".added")).not.toContainText("Clients/");
  // Filing moves the file from the Library intake into its area folder (corpus.rs file_note).
  await expect(pair.locator(".file")).toHaveText(["wiki/_inbox/dana-call.md", "wiki/Clients/dana-call.md"]);
});

test("the page passes into the privacy night and back out, either way", async ({ page }) => {
  await page.goto("/");
  const header = page.locator(".site-header-bar");
  const themeColor = page.locator('meta[name="theme-color"]');
  expect(await passage(page)).toBe("");

  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  await expect(themeColor).toHaveAttribute("content", "#0e171d");
  await expect(header).toHaveCSS("background-color", "rgb(14, 23, 29)");

  // Out through the top: the page above it is light again.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => passage(page)).toBe("");
  await expect(themeColor).toHaveAttribute("content", "#f8f2e9");
  await expect(header).toHaveCSS("background-color", "rgb(248, 242, 233)");

  // In again, and out through the bottom.
  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  await scrollToPrivacy(page, 1.6);
  await expect.poll(() => passage(page)).toBe("");
});

test("a reload in the middle of the privacy band lands in the night at once", async ({ page }) => {
  await page.goto("/");
  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  await page.reload();
  await expect.poll(() => passage(page)).toBe("ocean-dark");
});

test("the theme studio's steps sit on one row at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const steps = page.locator(".studio-steps");
  await steps.scrollIntoViewIfNeeded();
  const [previous, label, next] = await Promise.all([
    steps.getByRole("button", { name: "Previous theme" }).boundingBox(),
    steps.locator(".carousel-label").boundingBox(),
    steps.getByRole("button", { name: "Next theme" }).boundingBox(),
  ]);
  expect(previous && label && next).toBeTruthy();
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(middle(previous!) - middle(next!))).toBeLessThan(2);
  expect(Math.abs(middle(previous!) - middle(label!))).toBeLessThan(12);
  expect(previous!.x).toBeLessThan(label!.x);
  expect(label!.x).toBeLessThan(next!.x);
});

test("the band keeps two figures, each with its population and its source", async ({ page }) => {
  await page.goto("/");
  const figures = page.locator("#waiting .figures li");
  await expect(figures.locator(".value")).toHaveText([/^50\.4%/, /^Half/]);
  await expect(figures.nth(0)).toContainText("paying for ChatGPT");
  await expect(figures.nth(0)).toContainText("past 30 days");
  await expect(figures.nth(1)).toContainText("pay for AI");
  // Footnotes are per source: Self Financial (1) and Menlo (2).
  const marks = await figures
    .locator("sup a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(marks).toEqual(["#fn-1", "#fn-2"]);
  await expect(page.locator("#fn-1")).toContainText("1,272 U.S. adults about their subscriptions");
  await expect(page.locator("#fn-1")).toContainText("among respondents paying for ChatGPT");
  await expect(page.locator("#fn-2")).toContainText("Menlo Ventures");
  await expect(page.locator("#fn-2")).toContainText("Among AI users who pay for AI, 50% use it daily");
  await expect(page.locator("#waiting")).not.toContainText(/wasted/i);
  // ChatGPT is still named, so the owners' line stays; the logos left with the bench.
  await expect(page.locator("#waiting .marks")).toHaveText("Product names belong to their owners.");
  await expect(page.locator("img[src^='/logos/']")).toHaveCount(0);
});

test("the landing says rotli is more than notes and asks no extra AI fee", async ({ page }) => {
  await page.goto("/");
  // The Overview tells the view-and-vault story now; "more than notes" is the hero's and the FAQ's.
  await expect(page.locator(".hero .hero-lede")).toContainText("Docs and Sheets");
  await expect(page.locator("#waiting .close")).toContainText("no extra AI plan to buy");
  const faq = page.locator(".faq-list summary");
  await expect(faq.filter({ hasText: "Do I have to pay for AI?" })).toHaveCount(1);
  await expect(faq.filter({ hasText: "Is rotli just a notes app?" })).toHaveCount(1);
});

// Scroll to `offset` px past the point where the band locks (under the header, or with its end
// on the window's end when it is taller). The band is sticky, so it is measured from the
// section after it, which is not.
const scrollPastLock = (page: Page, offset: number) =>
  page.evaluate((o) => {
    const band = document.getElementById("privacy")!;
    const next = document.getElementById("faq")!;
    const header = document.querySelector<HTMLElement>(".site-header-bar")!.offsetHeight;
    const top = next.getBoundingClientRect().top + window.scrollY - band.offsetHeight;
    const lock = Math.max(-header, band.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + lock + o, behavior: "instant" });
  }, offset);

test("only the header crosses into the night; the band paints its own and nothing else changes", async ({
  page,
}) => {
  await page.goto("/");
  await scrollPastLock(page, 40);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  const colour = (selector: string) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => colour(".site-header-bar")).toBe("rgb(14, 23, 29)");
  // The header's words follow its ground, not the page's.
  await expect(page.locator(".site-header-bar")).toHaveCSS("color", "rgb(231, 240, 244)");
  expect(await colour("#privacy")).toBe("rgb(14, 23, 29)");
  // The page and the questions keep the day: no crossfade of the whole page.
  expect(await colour("body")).toBe("rgb(248, 242, 233)");
  expect(await colour("#faq")).toBe("rgb(248, 242, 233)");
});

test("the band locks, the questions slide up over it, and daylight returns as they reach the header", async ({
  page,
}) => {
  await page.goto("/");
  const top = (selector: string) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
  // The band's words and scene are there as it comes up the window, in its own night.
  await scrollPastLock(page, -400);
  expect(await passage(page)).toBe("");
  await expect(page.locator("#privacy > .wrap")).toHaveCSS("opacity", "1");
  // Locked: scrolling on moves the questions, not the band.
  await scrollPastLock(page, 20);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  const locked = await top("#privacy");
  const faq = await top("#faq");
  await scrollPastLock(page, 220);
  expect(Math.abs((await top("#privacy")) - locked)).toBeLessThanOrEqual(1);
  expect(Math.abs((await top("#faq")) - (faq - 200))).toBeLessThanOrEqual(1);
  // The questions sit over the band (their own ground, above it).
  const over = await page.evaluate(() => {
    const faqBox = document.getElementById("faq")!.getBoundingClientRect();
    const hit = document.elementFromPoint(innerWidth / 2, faqBox.top + 10);
    return hit ? Boolean(hit.closest("#faq")) : false;
  });
  expect(over).toBe(true);
  // Once the questions reach the header, the header is day again.
  await page.evaluate(() => {
    const faqBox = document.getElementById("faq")!.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + faqBox.top - 40, behavior: "instant" });
  });
  await expect.poll(() => passage(page)).toBe("");
  await expect
    .poll(() => page.locator(".site-header-bar").evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe("rgb(248, 242, 233)");
});

test("under reduced motion the page switches to the night at once", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  // No transition on the root: the very next frame is already the night.
  const state = await page.evaluate(() => ({
    running: document
      .getAnimations()
      .filter((a) => a.effect instanceof KeyframeEffect && a.effect.target === document.documentElement)
      .length,
    header: getComputedStyle(document.querySelector(".site-header-bar")!).backgroundColor,
  }));
  expect(state).toEqual({ running: 0, header: "rgb(14, 23, 29)" });
  // The band's words are there at once too, with no wait for the ink switch.
  expect(await page.locator("#privacy > .wrap").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await context.close();
});

test("the band's teaser is the post's thumbnail, linked to the study, level with the words", async ({
  page,
}) => {
  await page.goto("/");
  const study = page.locator("#waiting a.study");
  await expect(study).toHaveAttribute("href", "/blog/the-ai-you-already-pay-for/");
  await expect(study).toHaveAccessibleName("Read the study");
  const art = study.locator("img");
  await expect(art).toHaveAttribute("src", "/thumbs/blog/the-ai-you-already-pay-for.webp");
  await expect(art).toHaveAttribute("alt", "");
  await study.click();
  await expect(page).toHaveURL(/\/blog\/the-ai-you-already-pay-for\/$/);

  type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
  for (const width of [320, 390, 768, 1024, 1180, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const band = page.locator("#waiting");
    await band.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        band.locator(".study img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    const read = (selector: string) =>
      band.locator(selector).evaluate((el) => el.getBoundingClientRect().toJSON() as Box);
    const [title, close, frame, cta] = await Promise.all([
      read("#waiting-title"),
      read(".close"),
      read(".study-art"),
      read(".study-cta"),
    ]);
    const shape = frame.width / frame.height;
    if (width >= 1180) {
      // Beside the words: the picture's top on the headline's, the call to action's bottom on
      // the close's, and a crop that only ever takes sky or a sliver of the side margins.
      expect(Math.abs(frame.top - title.top), `top edge at ${width}`).toBeLessThanOrEqual(2);
      expect(Math.abs(cta.bottom - close.bottom), `bottom edge at ${width}`).toBeLessThanOrEqual(2);
      expect(frame.left).toBeGreaterThan(close.right);
      expect(shape, `shape at ${width}`).toBeGreaterThanOrEqual(1200 / 630 / 1.08 - 0.01);
      expect(shape, `shape at ${width}`).toBeLessThanOrEqual(1200 / 630 / 0.87 + 0.01);
    } else {
      // Under the words, at its own shape.
      expect(frame.top).toBeGreaterThan(close.bottom);
      expect(Math.abs(shape - 1200 / 630)).toBeLessThan(0.02);
    }
    expect(cta.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("the film sits across the hand-off: the warm band begins behind it, with no strip between", async ({
  browser,
}) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    // Let the film's arrival finish: it rises once and rests.
    await page.locator(".hero-film").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const state = await page.evaluate(() => {
      const strip = document.querySelector(".below-fold")!;
      const film = document.querySelector(".hero-film video")!.getBoundingClientRect();
      const band = document.querySelector("#waiting")!;
      const bandTop = band.getBoundingClientRect().top;
      return {
        // The strip's ground eases from the page's into the band's.
        image: getComputedStyle(strip).backgroundImage,
        bandColour: getComputedStyle(band).backgroundColor,
        stripIsBefore: strip.nextElementSibling === band,
        gap: bandTop - film.bottom,
        // Nothing about the film is tied to the scroll.
        scrollLinked: document
          .getAnimations()
          .some((a) => a.timeline && !(a.timeline instanceof DocumentTimeline)),
      };
    });
    expect(state.image).toContain("linear-gradient");
    expect(state.image).toContain("241, 231, 216");
    expect(state.bandColour).toBe("rgb(241, 231, 216)");
    expect(state.stripIsBefore).toBe(true);
    expect(state.gap).toBeGreaterThanOrEqual(0);
    expect(state.gap).toBeLessThan(8);
    expect(state.scrollLinked).toBe(false);
    if (reducedMotion === "reduce") {
      const running = await page.locator(".hero-film").evaluate((el) => el.getAnimations().length);
      expect(running).toBe(0);
    }
    await context.close();
  }
});
