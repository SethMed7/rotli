// The blog's width (the owner, 2026-10-06: "for blogs let's use more width, we have more space to
// use, and let's consider responsiveness"). A post sits on the blog's wider page (Base `widePage`:
// 96rem, 104rem on the widest screens) on named tracks (WritingPage --article-tracks): fluid rails
// and a middle that holds a reading column of about 68 characters, which figures break out of.
// Swept from 320 to 2560: no sideways scroll, nothing over the reading column, 60 to 80
// characters a line wherever the window is wider than a phone, the head on the text's edge, the
// rails folding right side first (under 1280px) and then the left rail (under 901px), and the
// same layout after a live resize as on a fresh load. The index is swept the same way.
import { expect, test, type Page } from "@playwright/test";

const POST = "/blog/the-ai-you-already-pay-for/";
const WIDTHS = [320, 390, 600, 768, 900, 1024, 1180, 1280, 1440, 1680, 1920, 2560];

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

    // The head's words start on the reading column's edge; the picture spans the page's width.
    expect(Math.abs(g.copy.x - g.text.x)).toBeLessThan(1.5);
    expect(Math.abs(g.art.x - g.main.x)).toBeLessThan(1.5);
    expect(Math.abs(g.art.width - g.main.width)).toBeLessThan(1.5);
    // The header keeps the site's standard width on every page (the owner, 2026-10-06): never
    // wider than 76rem, centred, so nothing shifts between the landing and the blog.
    expect(g.header.width).toBeLessThanOrEqual(76 * 16 + 1.5);
    expect(Math.abs(g.header.x - (width - g.header.width) / 2)).toBeLessThan(2);

    // The rails fold in order: both beside the text from 1280px, the right side under the article
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
    if (width >= 1280) {
      expect(apart(g.middle, g.more!)).toBe(true);
      expect(g.more!.x + g.more!.width).toBeLessThanOrEqual(width);
    } else {
      expect(g.more!.y).toBeGreaterThan(g.middle.y + g.middle.height);
      expect(Math.abs(g.more!.x - g.text.x)).toBeLessThan(1.5);
    }

    // Figures stay inside the middle, never in a rail; where the middle has room they break out
    // wider than the words, and are never narrower.
    expect(g.figures.length).toBeGreaterThan(0);
    for (const figure of g.figures) {
      expect(figure.x).toBeGreaterThanOrEqual(g.middle.x - 1);
      expect(figure.x + figure.width).toBeLessThanOrEqual(g.middle.x + g.middle.width + 1);
      expect(figure.width).toBeGreaterThanOrEqual(g.text.width - 1);
      if (g.railBox && width >= 901) expect(overlaps(figure, g.railBox)).toBe(false);
      if (width >= 1280) expect(overlaps(figure, g.more!)).toBe(false);
    }
    if (width >= 1680) expect(g.figures[0]!.width).toBeGreaterThan(g.text.width + 64);
  });
}

test("the blog's page is wider than the site's, and grows on the widest screens", async ({ page }) => {
  const widthAt = async (viewport: number) => {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.goto(POST);
    return (await page.locator("main.writing").boundingBox())!.width;
  };
  // The site's own page stops at 76rem (1216px); the blog's at 96rem, 104rem at 2560.
  expect(await widthAt(1920)).toBeCloseTo(1536, 0);
  expect(await widthAt(2560)).toBeCloseTo(1664, 0);
  await page.goto("/privacy/");
  expect((await page.locator("main.writing").boundingBox())!.width).toBeCloseTo(1216, 0);
});

test("type eases up a little on the widest screens and the line keeps its measure", async ({ page }) => {
  const sizeAt = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    return page
      .locator("[data-prose] > p")
      .first()
      .evaluate((p) => parseFloat(getComputedStyle(p).fontSize));
  };
  expect(await sizeAt(1440)).toBeCloseTo(18, 0);
  const wide = await sizeAt(2560);
  expect(wide).toBeGreaterThan(18);
  expect(wide).toBeLessThanOrEqual(20);
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
  // The right side is too tall to hold in a 700px window, so it scrolls with the page instead of
  // being cut off.
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
  expect(await columnsWith(4, 1536)).toBe(4);
  expect(await columnsWith(3, 1536)).toBe(3);
  expect(await columnsWith(2, 1536)).toBe(2);
  expect(await columnsWith(4, 900)).toBe(3);
  expect(await columnsWith(4, 600)).toBe(2);
  expect(await columnsWith(4, 340)).toBe(1);
});
