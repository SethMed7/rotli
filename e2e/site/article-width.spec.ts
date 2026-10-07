// The blog's width (the owner, 2026-10-06: first "for blogs let's use more width", then "now the
// blog width is too much", then "picture matches header width" and "remove the part on right and
// move blog content more right"; then, 2026-10-07, one left edge, wide blocks to the page's right
// edge, bullets hung: docs/design/article-pages-width-2026-10-07.md). A post sits on the site's one
// 76rem page, the header's, on named tracks (`.longform`, blog/article.css): the left rail, its
// gap, then a reading column of about 66 characters on one left edge, and the room right of it for
// wide blocks. There is no right rail; "More from rotli" follows the article. Swept from 320 to
// 2560: no sideways scroll, nothing over the reading column, 60 to 80 characters a line wherever
// the window is wider than a phone (62 to 70 from 1180px), the head on the header's edges, the left
// rail at least 16rem from 1440, the rail folding under 901px, one left edge for words, figures,
// and a list's words, figures ending on the page's right edge where they break out, and the same
// layout after a live resize as on a fresh load. Posts, /privacy/, and /roadmap/ share the rail
// and the edge. The index is swept the same way.
import { expect, test, type Page } from "@playwright/test";

const POST = "/blog/the-ai-you-already-pay-for/";
const WIDTHS = [320, 390, 600, 768, 900, 1024, 1180, 1280, 1359, 1360, 1440, 1680, 1920, 2560];
/** Where the head's words and picture go side by side (blog/ArticleCover.astro). */
const SIDE_BY_SIDE = 1000;
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
    const item = document.querySelector("[data-prose] > ul:not(.flow) > li");
    return {
      text: rect("[data-prose] > p")!,
      listText: item ? item.getBoundingClientRect().x : null,
      middle: rect("[data-prose]")!,
      rail: rect("[data-article-rail] .rail-title"),
      railBox: rect("[data-article-rail]"),
      more: rect("[data-article-more]"),
      copy: rect("[data-article-cover] .head-copy")!,
      art: rect("[data-article-art]")!,
      main: rect("main.writing")!,
      header: rect(".site-header")!,
      cover: rect("[data-article-cover]")!,
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
    // Beside the rail at its full width, a comfortable 62 to 70.
    if (width >= 1180) {
      expect(g.characters).toBeGreaterThanOrEqual(62);
      expect(g.characters).toBeLessThanOrEqual(70);
    }
    // 18px at every width: no growth on the widest screens.
    expect(g.fontSize).toBeCloseTo(18, 1);

    // The head is on the header's edges, the page's (the logo's and Download's). Stacked, the
    // picture spans them and the words start on the left one where there is a rail, on the reading
    // column's edge where there is not; side by side, the words start on the left edge and the
    // picture ends on the right one.
    const right = (box: Box) => box.x + box.width;
    expect(Math.abs(g.cover.x - g.header.x)).toBeLessThan(1.5);
    expect(Math.abs(right(g.cover) - right(g.header))).toBeLessThan(1.5);
    expect(Math.abs(right(g.art) - right(g.header))).toBeLessThan(1.5);
    if (width >= SIDE_BY_SIDE) {
      expect(Math.abs(g.copy.x - g.header.x)).toBeLessThan(1.5);
      expect(right(g.copy)).toBeLessThan(g.art.x);
    } else {
      expect(Math.abs(g.art.x - g.header.x)).toBeLessThan(1.5);
      if (width >= 901) expect(Math.abs(g.copy.x - g.header.x)).toBeLessThan(1.5);
      else expect(Math.abs(g.copy.x - g.text.x)).toBeLessThan(1.5);
    }
    // The page is the header's: never wider than 76rem, centred, so nothing shifts between pages.
    expect(Math.abs(g.main.x - g.header.x)).toBeLessThan(1.5);
    expect(Math.abs(g.main.width - g.header.width)).toBeLessThan(1.5);
    expect(g.header.width).toBeLessThanOrEqual(76 * 16 + 1.5);
    expect(Math.abs(g.header.x - (width - g.header.width) / 2)).toBeLessThan(2);

    // The left rail beside the text from 901px, its Share under the article below that (its tree
    // is the disclosure). The reading column starts one rail gap (2 to 2.5rem) past the rail: it is
    // not centred in the room, so the gap is never more than that. The room runs to the page's edge.
    if (width >= 901) {
      expect(g.rail, "the left rail shows").not.toBeNull();
      expect(apart(g.railBox!, g.middle)).toBe(true);
      await expect(page.locator(".toc-compact")).toBeHidden();
      expect(Math.abs(g.text.x - g.middle.x)).toBeLessThan(1.5);
      const gap = g.text.x - right(g.railBox!);
      expect(gap).toBeGreaterThanOrEqual(2 * REM - 1);
      expect(gap).toBeLessThanOrEqual(2.5 * REM + 1);
      expect(Math.abs(right(g.middle) - right(g.header))).toBeLessThan(1.5);
      // A list's markers hang in the gap, so its words are on the column's edge.
      expect(Math.abs(g.listText! - g.text.x)).toBeLessThan(1.5);
    } else {
      // No rail: the column starts on the page's left edge, a list's words 1.3rem in.
      expect(Math.abs(g.text.x - g.header.x)).toBeLessThan(1.5);
      expect(Math.abs(g.listText! - g.text.x - 1.3 * REM)).toBeLessThan(1.5);
      expect(g.rail, "the left rail folds away").toBeNull();
      await expect(page.locator(".toc-compact")).toBeVisible();
      expect(g.railBox!.y).toBeGreaterThan(g.text.y);
    }
    // No right rail at any width: "More from rotli" follows the article on the text's edges.
    expect(g.more!.y).toBeGreaterThan(g.middle.y + g.middle.height);
    expect(Math.abs(g.more!.x - g.text.x)).toBeLessThan(1.5);
    expect(Math.abs(right(g.more!) - right(g.text))).toBeLessThan(1.5);
    expect(await page.locator("[data-prose] ~ [data-article-more]").count()).toBe(0);

    // Figures start on the words' edge, never in a rail, never narrower than the words, and either
    // keep the measure or run on to the page's right edge, never a sliver past the words.
    expect(g.figures.length).toBeGreaterThan(0);
    for (const figure of g.figures) {
      expect(Math.abs(figure.x - g.text.x)).toBeLessThan(1.5);
      expect(figure.width).toBeGreaterThanOrEqual(g.text.width - 1);
      const breaksOut = figure.width > g.text.width + 1;
      if (breaksOut) {
        expect(Math.abs(right(figure) - right(g.header))).toBeLessThan(1.5);
        expect(figure.width).toBeGreaterThanOrEqual(g.text.width + 5 * REM - 1);
      }
      if (g.railBox && width >= 901) expect(overlaps(figure, g.railBox)).toBe(false);
    }
    // Beside the rail at its full width the room is there, and a figure breaks out of the words.
    if (width >= 1180) expect(g.figures[0]!.width).toBeGreaterThan(g.text.width + 5 * REM);
  });
}

for (const width of [1440, 1920, 2560]) {
  test(`at ${width}px the left rail has room: 16rem`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    const g = await geometry(page);
    expect(g.railBox!.width).toBeGreaterThanOrEqual(16 * REM - 0.5);
  });
}

// The owner, 2026-10-07: the long-form pages are one family on one layout. A post, /privacy/, and
// /roadmap/ put their rail (or "On this page" nav) and their first words on the same x at every
// width beside a rail, and the privacy matrix and the roadmap's groups start on that same edge.
for (const width of [901, 1024, 1180, 1440, 1920]) {
  test(`posts, privacy, and the roadmap share one rail and one left edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const edges = async (path: string, rail: string, text: string, wide: string) => {
      await page.goto(path);
      return page.evaluate(
        (selectors) => {
          const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          return {
            rail: [box(selectors.rail).left, box(selectors.rail).right],
            text: box(selectors.text).left,
            wide: box(selectors.wide).left,
          };
        },
        { rail, text, wide },
      );
    };
    const post = await edges(POST, "[data-article-rail]", "[data-prose] > p", "[data-prose] > figure.figure");
    const privacy = await edges("/privacy/", "[data-article-rail]", "#promise", ".promise-matrix");
    const roadmap = await edges("/roadmap/", "[data-roadmap-nav]", ".road-body .section-note", ".work-grid");
    for (const other of [privacy, roadmap]) {
      expect(Math.abs(other.rail[0]! - post.rail[0]!)).toBeLessThan(1.5);
      expect(Math.abs(other.rail[1]! - post.rail[1]!)).toBeLessThan(1.5);
      expect(Math.abs(other.text - post.text)).toBeLessThan(1.5);
    }
    for (const page of [post, privacy, roadmap]) expect(Math.abs(page.wide - post.text)).toBeLessThan(1.5);
  });
}

// The owner, 2026-10-06: "picture matches header width". Every width from 1024 to 2560: the head
// and its picture end on the header's edges (the logo's left, Download's right), ±1.5px.
for (const width of [1024, 1100, 1180, 1280, 1366, 1440, 1536, 1680, 1920, 2240, 2560]) {
  test(`the head and its picture are on the header's edges at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    const edges = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      };
      return {
        header: box(".site-header"),
        logo: box(".site-header .brand"),
        download: box(".site-header .header-download"),
        head: box("[data-article-cover]"),
        copy: box("[data-article-cover] .head-copy"),
        art: box("[data-article-art]"),
      };
    });
    expect(Math.abs(edges.head.left - edges.header.left)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(edges.head.right - edges.header.right)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(edges.copy.left - edges.header.left)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(edges.copy.left - edges.logo.left)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(edges.art.right - edges.header.right)).toBeLessThanOrEqual(1.5);
    // Where Download is the header's last control (the menu button follows it below 1080px).
    if (width >= 1100) expect(Math.abs(edges.art.right - edges.download.right)).toBeLessThanOrEqual(1.5);
  });
}

test("a post's page is the site's 76rem and never grows, like /blog/ and the rest", async ({ page }) => {
  const widthAt = async (path: string, viewport: number) => {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.goto(path);
    return (await page.locator("main.writing").boundingBox())!.width;
  };
  expect(await widthAt(POST, 1920)).toBeCloseTo(76 * REM, 0);
  expect(await widthAt(POST, 2560)).toBeCloseTo(76 * REM, 0);
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
