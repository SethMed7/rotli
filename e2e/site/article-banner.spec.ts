// The top of an article. /privacy/ keeps the banner (WritingPage `banner`): a full-width picture
// under the header that takes most of the first window, a head panel on the page's ground whose
// title and date are in that first window at full contrast, and the page rising over the pinned
// banner as it scrolls (the meter and the tree still pinned and clear of each other).
// Blog posts open on their cover instead (WritingPage `article`, blog/ArticleCover.astro): the
// scene across the article's columns, rounded and still, then the title, the summary, the meta
// line, and the topics on the page's ground, nothing over the picture, the words on the reading
// column's edge and "Blog /" on the rail's, contrast measured, the title in the first window.
import { expect, test, type Page } from "@playwright/test";

const POSTS = ["/blog/rotli-web-and-your-mac/", "/blog/the-ai-you-already-pay-for/"];
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

/** WCAG contrast of two computed colours (rgb()/rgba() or color(srgb …)); throws on transparency. */
function contrastOf(fg: string, bg: string): number {
  const parse = (value: string) => {
    const srgb = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
    if (srgb) return { rgb: srgb.slice(1, 4).map(Number), alpha: Number(srgb[4] ?? 1) };
    const rgb = value.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!rgb) throw new Error(`unparsed colour ${value}`);
    return { rgb: rgb.slice(1, 4).map((c) => Number(c) / 255), alpha: Number(rgb[4] ?? 1) };
  };
  const lum = (value: string) => {
    const { rgb, alpha } = parse(value);
    if (alpha !== 1) throw new Error(`${value} is not opaque, so its contrast means nothing`);
    const [r = 0, g = 0, b = 0] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const colours = (page: Page, text: string, ground: string) =>
  page.evaluate(
    ({ textSel, groundSel }) => ({
      fg: getComputedStyle(document.querySelector(textSel)!).color,
      bg: getComputedStyle(document.querySelector(groundSel)!).backgroundColor,
    }),
    { textSel: text, groundSel: ground },
  );

async function box(page: Page, selector: string) {
  return (await page.locator(selector).first().boundingBox())!;
}

for (const path of ["/privacy/"]) {
  for (const viewport of VIEWPORTS) {
    test(`${path} opens on its banner with the title readable in the first window (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(path);
      const header = await box(page, ".site-header-bar");
      const banner = await box(page, "[data-article-banner]");
      // Under the header, full width, and most of the window on a desktop; shorter on a phone.
      expect(Math.abs(banner.y - (header.y + header.height))).toBeLessThan(2);
      expect(banner.width).toBeGreaterThanOrEqual(viewport.width - 1);
      if (viewport.width > 900) expect(banner.height).toBeGreaterThan(viewport.height * 0.5);
      else expect(banner.height).toBeLessThan(viewport.height * 0.62);

      // The title and the date line are inside the first window, with no scrolling.
      for (const selector of [".writing-head h1", ".writing-head .meta"]) {
        const part = await box(page, selector);
        expect(part.y).toBeGreaterThanOrEqual(header.y + header.height);
        expect(part.y + part.height).toBeLessThanOrEqual(viewport.height);
      }
      // The panel rises over the banner's bottom edge, more on a wide screen than on a phone.
      const panel = await box(page, ".writing-head .head-copy");
      const overlap = banner.y + banner.height - panel.y;
      expect(overlap).toBeGreaterThan(viewport.width > 900 ? 80 : 12);
      expect(overlap).toBeLessThan(viewport.width > 900 ? 160 : 40);

      // Read on the panel's own opaque ground: measured, at least 4.5:1.
      for (const text of [".writing-head h1", ".writing-head .meta", ".writing-head .lede"]) {
        const { fg, bg } = await colours(page, text, ".writing-head .head-copy");
        expect(contrastOf(fg, bg), `${text} on the panel`).toBeGreaterThanOrEqual(4.5);
      }
      if (path === "/privacy/") {
        // The caption in the night sky: its own ground, never the stars or the clouds.
        const { fg, bg } = await colours(page, ".night-caption", ".night-caption");
        expect(contrastOf(fg, bg)).toBeGreaterThanOrEqual(4.5);
        const caption = await box(page, ".night-caption");
        const dome = await box(page, ".dome-frame");
        if (viewport.width > 900) expect(caption.x + caption.width).toBeLessThanOrEqual(dome.x);
        else expect(caption.y + caption.height).toBeLessThanOrEqual(dome.y);
        expect(caption.y + caption.height).toBeLessThanOrEqual(panel.y);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }

  test(`${path}: the page rises over the pinned banner, and the meter and tree stay clear`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 3);
    });
    const header = await box(page, ".site-header-bar");
    // The banner stays where it was, under the header, and the sheet covers it.
    const banner = await box(page, "[data-article-banner]");
    expect(Math.abs(banner.y - (header.y + header.height))).toBeLessThan(2);
    const covered = await page.evaluate(
      ({ x, y }) => !document.elementFromPoint(x, y)?.closest("[data-article-banner]"),
      { x: 720, y: banner.y + banner.height / 2 },
    );
    expect(covered).toBe(true);
    const meter = await box(page, "[data-read-progress]");
    expect(Math.abs(meter.y - (header.y + header.height))).toBeLessThan(2);
    await expect
      .poll(() => page.locator("[data-read-progress]").getAttribute("aria-valuenow").then(Number))
      .toBeGreaterThan(0);
    const label = await box(page, "[data-toc] > p");
    expect(label.y).toBeGreaterThanOrEqual(meter.y + meter.height + 8);
  });
}

const POST_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

for (const path of POSTS) {
  for (const viewport of POST_VIEWPORTS) {
    test(`${path} opens on its picture, then its title, summary, and meta line (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(path);
      // No banner, no pinned picture: the cover sits inside the page's width.
      await expect(page.locator("[data-article-banner]")).toHaveCount(0);
      const header = await box(page, ".site-header-bar");
      const wrap = await box(page, "main.writing");
      const art = await box(page, "[data-article-art]");
      expect(art.x).toBeGreaterThanOrEqual(wrap.x - 1);
      expect(art.x + art.width).toBeLessThanOrEqual(wrap.x + wrap.width + 1);
      expect(art.width).toBeLessThan(viewport.width);
      expect(art.y).toBeGreaterThan(header.y + header.height);
      expect(
        await page.locator("[data-article-art]").evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
      ).not.toBe("0px");
      const img = page.locator("[data-article-art] img");
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
      expect((await img.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(20);

      // The head: title, then summary, then the meta line (author, date, reading time), then topics.
      const head = page.locator("[data-article-cover] .head-copy");
      await expect(head.locator(".author")).toHaveText("Seth Medina");
      await expect(head.locator(".byline")).toContainText("min read");
      await expect(head.locator(".byline")).toContainText(/2026/);
      await expect(head.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(head.locator(".lede")).toBeVisible();
      expect(await head.getByRole("list", { name: "Topics" }).getByRole("listitem").count()).toBeGreaterThan(
        0,
      );
      const [title, lede, byline, tags] = await Promise.all(
        ["h1", ".lede", ".byline", ".tags"].map((selector) =>
          box(page, `[data-article-cover] .head-copy ${selector}`),
        ),
      );
      expect(lede!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
      expect(byline!.y).toBeGreaterThanOrEqual(lede!.y + lede!.height - 1);
      expect(tags!.y).toBeGreaterThanOrEqual(byline!.y + byline!.height - 1);
      // The type steps down: title, summary, meta.
      const size = (selector: string) =>
        page
          .locator(`[data-article-cover] .head-copy ${selector}`)
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(await size("h1")).toBeGreaterThan(await size(".lede"));
      expect(await size(".lede")).toBeGreaterThan(await size(".byline"));

      // Nothing over the picture: the words start below it, at every width.
      const copy = await box(page, "[data-article-cover] .head-copy");
      expect(copy.y).toBeGreaterThanOrEqual(art.y + art.height);
      // The title is in the first window.
      expect(title!.y + title!.height).toBeLessThanOrEqual(viewport.height);

      if (viewport.width > 900) {
        // On the article's tracks: the words on the reading column's edge (a paragraph's, since
        // [data-prose] is the wider middle that figures break out to), "Blog /" on the rail's, the
        // picture across the columns.
        const text = await box(page, "[data-prose] > p");
        const rail = await box(page, "[data-article-rail]");
        expect(Math.abs(copy.x - text.x)).toBeLessThan(1.5);
        expect(Math.abs((await box(page, "[data-article-cover] .crumbs")).x - rail.x)).toBeLessThan(1.5);
        expect(Math.abs(art.x - rail.x)).toBeLessThan(1.5);
        if (viewport.width >= 1280) {
          const aside = await box(page, "[data-article-more]");
          expect(Math.abs(art.x + art.width - (aside.x + aside.width))).toBeLessThan(1.5);
        }
      }

      // Read on the page's own ground: measured, at least 4.5:1, topics included.
      for (const text of ["h1", ".byline", ".lede", ".author", ".tags li"]) {
        const { fg, bg } = await colours(page, `[data-article-cover] .head-copy ${text}`, "body");
        expect(contrastOf(fg, bg), text).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }
}

test("a post's cover stays still as the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POSTS[0]!);
  const before = await box(page, "[data-article-art]");
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 300);
  });
  await page.waitForTimeout(150);
  const after = await box(page, "[data-article-art]");
  // It scrolls away with the page (nothing pinned), and nothing scales it.
  expect(before.y - after.y).toBeGreaterThan(290);
  expect(await page.locator("[data-article-art] img").evaluate((el) => getComputedStyle(el).transform)).toBe(
    "none",
  );
  expect(
    await page.locator("[data-article-art] img").evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});
