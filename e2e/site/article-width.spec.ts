// The blog's width (the owner, 2026-10-06: first "for blogs let's use more width ... and let's
// consider responsiveness", then "now the blog width is too much ... the left and right panels use
// more width to clear up visual clutter"). A post sits on its own page (Base `widePage`: 88rem,
// fixed) on named tracks (WritingPage --article-tracks): wide fluid rails and a middle that holds
// a reading column of about 66 characters. /blog/ is the site's standard 76rem page.
// Swept from 320 to 2560: no sideways scroll, nothing over the reading column, 60 to 80
// characters a line wherever the window is wider than a phone (62 to 70 beside both rails), the
// head on the page's edge, rails at least 18rem at 1440 and 1920, the rails folding right side
// first (under 1360px) and then the left rail (under 901px), figures never over-wide, and the
// same layout after a live resize as on a fresh load. The index is swept the same way.
import { expect, test, type Page } from "@playwright/test";

const POST = "/blog/the-ai-you-already-pay-for/";
const WIDTHS = [320, 390, 600, 768, 900, 1024, 1180, 1280, 1359, 1360, 1440, 1680, 1920, 2560];
/** Where the right side comes beside the text (WritingPage, blog/ArticleAside.astro). */
const THREE_COLUMNS = 1360;
const REM = 16;

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
/** Side by side: one box wholly left of the other (the rails run the article's height, so only x counts). */
const apart = (left: Box, right: Box) => left.x + left.width <= right.x + 1;

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The article's geometry: the reading column is a paragraph's box, the middle is [data-prose]. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0
        ? { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height }
        : null;
    };
    const paragraph = document.querySelector<HTMLElement>("[data-prose] > p")!;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1ch";
    paragraph.append(probe);
    const ch = probe.getBoundingClientRect().width;
    probe.remove();
    const figures = [...document.querySelectorAll("[data-prose] > figure.figure")].map((figure) => {
      const box = figure.getBoundingClientRect();
      return { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height };
    });
    return {
      text: rect("[data-prose] > p")!,
      middle: rect("[data-prose]")!,
      rail: rect("[data-article-rail] .rail-title"),
      railBox: rect("[data-article-rail]"),
      more: rect("[data-article-more]"),
      copy: rect("[data-article-cover] .head-copy")!,
      art: rect("[data-article-art]")!,
      main: rect("main.writing")!,
      header: rect(".site-header")!,
      characters: paragraph.getBoundingClientRect().width / ch,
      fontSize: parseFloat(getComputedStyle(paragraph).fontSize),
      figures,
    };
  });

for (const width of WIDTHS) {
  test(`a post at ${width}px: no sideways scroll, nothing over the text, a readable line`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const g = await geometry(page);

    // 60 to 80 characters a line; on a phone the window, not the measure, sets the width.
    expect(g.characters).toBeLessThanOrEqual(80);
    if (width >= 768) expect(g.characters).toBeGreaterThanOrEqual(60);
    // Beside both rails, a comfortable 62 to 70.
    if (width >= THREE_COLUMNS) {
      expect(g.characters).toBeGreaterThanOrEqual(62);
      expect(g.characters).toBeLessThanOrEqual(70);
    }
    // 18px at every width: no growth on the widest screens.
    expect(g.fontSize).toBeCloseTo(18, 1);

    // The picture spans the page's width; the head's words start on its edge (the left rail's)
    // where there is a rail, on the reading column's edge where there is not.
    if (width >= 901) expect(Math.abs(g.copy.x - g.main.x)).toBeLessThan(1.5);
    else expect(Math.abs(g.copy.x - g.text.x)).toBeLessThan(1.5);
    expect(Math.abs(g.art.x - g.main.x)).toBeLessThan(1.5);
    expect(Math.abs(g.art.width - g.main.width)).toBeLessThan(1.5);
    // The header keeps the site's standard width on every page (the owner, 2026-10-06): never
    // wider than 76rem, centred, so nothing shifts between the landing and the blog.
    expect(g.header.width).toBeLessThanOrEqual(76 * 16 + 1.5);
    expect(Math.abs(g.header.x - (width - g.header.width) / 2)).toBeLessThan(2);

    // The rails fold in order: both beside the text from 1360px, the right side under the article
    // below that, and the left rail's Share under it below 901px (its tree is the disclosure).
    if (width >= 901) {
      expect(g.rail, "the left rail shows").not.toBeNull();
      expect(apart(g.railBox!, g.middle)).toBe(true);
      await expect(page.locator(".toc-compact")).toBeHidden();
    } else {
      expect(g.rail, "the left rail folds away").toBeNull();
      await expect(page.locator(".toc-compact")).toBeVisible();
      expect(g.railBox!.y).toBeGreaterThan(g.text.y);
    }
    if (width >= THREE_COLUMNS) {
      expect(apart(g.middle, g.more!)).toBe(true);
      expect(g.more!.x + g.more!.width).toBeLessThanOrEqual(width);
      // The right side and the cover's picture end on the same edge.
      expect(Math.abs(g.art.x + g.art.width - (g.more!.x + g.more!.width))).toBeLessThan(1.5);
    } else {
      expect(g.more!.y).toBeGreaterThan(g.middle.y + g.middle.height);
      expect(Math.abs(g.more!.x - g.text.x)).toBeLessThan(1.5);
    }

    // Figures stay inside the middle, never in a rail, never narrower than the words, and never
    // more than 5rem a side wider than them (nothing over-wide).
    expect(g.figures.length).toBeGreaterThan(0);
    for (const figure of g.figures) {
      expect(figure.x).toBeGreaterThanOrEqual(g.middle.x - 1);
      expect(figure.x + figure.width).toBeLessThanOrEqual(g.middle.x + g.middle.width + 1);
      expect(figure.width).toBeGreaterThanOrEqual(g.text.width - 1);
      expect(figure.width).toBeLessThanOrEqual(g.text.width + 10 * REM + 1);
      if (g.railBox && width >= 901) expect(overlaps(figure, g.railBox)).toBe(false);
      if (width >= THREE_COLUMNS) expect(overlaps(figure, g.more!)).toBe(false);
    }
    // With the left rail alone the middle has room, and a figure breaks out of the words.
    if (width >= 1180 && width < THREE_COLUMNS)
      expect(g.figures[0]!.width).toBeGreaterThan(g.text.width + 64);
  });
}

for (const width of [1440, 1920]) {
  test(`at ${width}px both rails have room: at least 18rem each`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    const g = await geometry(page);
    expect(g.railBox!.width).toBeGreaterThanOrEqual(18 * REM);
    expect(g.more!.width).toBeGreaterThanOrEqual(18 * REM);
  });
}

test("a post's page is 88rem and never grows; /blog/ and the rest of the site are 76rem", async ({
  page,
}) => {
  const widthAt = async (path: string, viewport: number) => {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.goto(path);
    return (await page.locator("main.writing").boundingBox())!.width;
  };
  expect(await widthAt(POST, 1920)).toBeCloseTo(88 * REM, 0);
  expect(await widthAt(POST, 2560)).toBeCloseTo(88 * REM, 0);
  expect(await widthAt("/blog/", 1920)).toBeCloseTo(76 * REM, 0);
  expect(await widthAt("/blog/", 2560)).toBeCloseTo(76 * REM, 0);
  expect(await widthAt("/privacy/", 1920)).toBeCloseTo(76 * REM, 0);
});

test("a live resize lands on the same layout as a fresh load", async ({ page }) => {
  const snapshot = async () => {
    const g = await geometry(page);
    return {
      text: [Math.round(g.text.x), Math.round(g.text.width)],
      middle: [Math.round(g.middle.x), Math.round(g.middle.width)],
      copy: Math.round(g.copy.x),
      rail: g.rail === null,
      more: g.more && [Math.round(g.more.x), Math.round(g.more.width)],
    };
  };
  const fresh: Record<number, unknown> = {};
  for (const width of [1920, 1180, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    fresh[width] = await snapshot();
  }
  await page.setViewportSize({ width: 2560, height: 900 });
  await page.goto(POST);
  for (const width of [1920, 1180, 390, 1180, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(snapshot).toEqual(fresh[width]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  }
});

test("in a short wide window both rails stay whole beside the text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(POST);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const prose = document.querySelector<HTMLElement>("[data-prose]")!;
    window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 2);
  });
  const rail = (await page.locator("[data-article-rail]").boundingBox())!;
  const header = (await page.locator(".site-header-bar").boundingBox())!;
  expect(rail.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(rail.y + rail.height).toBeLessThanOrEqual(700);
  // The right side is never pinned (blog/ArticleAside.astro): it scrolls away with the page.
  expect(await page.locator("[data-article-more]").evaluate((el) => getComputedStyle(el).position)).toBe(
    "static",
  );
});

for (const width of WIDTHS) {
  test(`the blog index at ${width}px: no sideways scroll, the list at a reading measure`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/blog/");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const layout = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const frame = box(document.querySelector("[data-featured] .frame")!);
      const copy = box(document.querySelector("[data-featured] .feature-copy")!);
      const rows = [...document.querySelectorAll("[data-post-list] > li")].map((row) => ({
        row: box(row).width,
        copy: box(row.querySelector(".list-copy")!).width,
      }));
      const columns = getComputedStyle(document.querySelector("[data-secondary] .row")!)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return { frame, copy, rows, columns, rem, page: box(document.querySelector("main.writing")!).width };
    });
    // The feature: beside its words where the page is wide, above them where not; it never overlaps.
    if (layout.page >= 52 * layout.rem) {
      expect(layout.copy.x).toBeGreaterThanOrEqual(layout.frame.x + layout.frame.width);
      expect(layout.frame.width).toBeGreaterThan(layout.page * 0.55);
    } else {
      expect(layout.copy.y).toBeGreaterThanOrEqual(layout.frame.y + layout.frame.height);
    }
    // The list's words keep a measure even when the row's hairline runs the page.
    for (const row of layout.rows) expect(row.copy).toBeLessThanOrEqual(46 * layout.rem + 1);
    // The row never has more than four columns.
    expect(layout.columns).toBeLessThanOrEqual(4);
    // The index is on the site's standard page, never wider than 76rem.
    expect(layout.page).toBeLessThanOrEqual(76 * layout.rem + 1);
  });
}

test("the row under the feature fits as many columns as there is room for, up to four", async ({ page }) => {
  // Today's blog has one post in the row; prove the rule on the row itself by giving it more.
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/blog/");
  const columnsWith = (count: number, width: number) =>
    page.evaluate(
      ([count, width]) => {
        const row = document.querySelector<HTMLElement>("[data-secondary] .row")!;
        const first = row.querySelector("li")!;
        row.replaceChildren(...Array.from({ length: count }, () => first.cloneNode(true)));
        row.parentElement!.style.width = `${width}px`;
        return getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length;
      },
      [count, width] as const,
    );
  // 1216px: the index's own width on the standard 76rem page.
  expect(await columnsWith(4, 1216)).toBe(4);
  expect(await columnsWith(3, 1216)).toBe(3);
  expect(await columnsWith(2, 1216)).toBe(2);
  expect(await columnsWith(4, 900)).toBe(3);
  expect(await columnsWith(4, 600)).toBe(2);
  expect(await columnsWith(4, 340)).toBe(1);
});
