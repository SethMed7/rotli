// The top of an article (WritingPage `article`, blog/ArticleCover.astro). The full-width pinned
// banner /privacy/ once opened on is gone: it now opens like a post (privacy-page.spec.ts).
// Blog posts open on their head, on the header's edges: from 1000px (SIDE_BY_SIDE) "Blog /", the
// title, the summary, the meta line, and the topics on the left and the post's picture on the
// right, whole (never cropped), the two centred on each other; below it, stacked as on a phone,
// the picture across the page and the words under it (on the page's edge from 901px, the reading
// column's below). Rounded and still, nothing over the picture, contrast measured, the title in the
// first window.
import { expect, test, type Page } from "@playwright/test";

const POSTS = ["/blog/rotli-web-and-your-mac/", "/blog/the-ai-you-already-pay-for/"];

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

const POST_VIEWPORTS = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1100, height: 800 },
  { width: 1024, height: 768 },
  { width: 999, height: 800 },
  { width: 900, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
/** Where the words and the picture go side by side (blog/ArticleCover.astro). */
const SIDE_BY_SIDE = 1000;

for (const path of POSTS) {
  for (const viewport of POST_VIEWPORTS) {
    test(`${path} opens on its title beside its picture, or under it when narrow (${viewport.width}px)`, async ({
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

      // Nothing over the picture: beside it on a wide screen, below it on a narrow one.
      const copy = await box(page, "[data-article-cover] .head-copy");
      const beside = viewport.width >= SIDE_BY_SIDE;
      if (beside) {
        expect(copy.x + copy.width).toBeLessThan(art.x);
        // Side by side and balanced: the two overlap in height and are centred on each other, so
        // neither leaves an empty band.
        expect(copy.y).toBeLessThan(art.y + art.height);
        expect(art.y).toBeLessThan(copy.y + copy.height);
        expect(Math.abs(copy.y + copy.height / 2 - (art.y + art.height / 2))).toBeLessThan(4);
        expect(Math.abs(copy.height - art.height)).toBeLessThan(Math.max(copy.height, art.height) * 0.25);
        // The picture is whole: the quokka crop at its own shape, nothing cut off.
        const shape = await page.locator("[data-article-art] img").evaluate((el: HTMLImageElement) => ({
          src: el.currentSrc,
          drawn: el.getBoundingClientRect().width / el.getBoundingClientRect().height,
          natural: el.naturalWidth / el.naturalHeight,
          fit: getComputedStyle(el).objectFit,
        }));
        expect(shape.src).toMatch(/-mobile\.webp$/);
        expect(Math.abs(shape.drawn - shape.natural)).toBeLessThan(0.02);
      } else {
        expect(copy.y).toBeGreaterThanOrEqual(art.y + art.height);
      }
      // The title is in the first window.
      expect(title!.y + title!.height).toBeLessThanOrEqual(viewport.height);

      // "Blog /" is part of the head: straight above the title, on its edge, nothing beside it.
      const crumbs = await box(page, "[data-article-cover] .head-copy .crumbs");
      expect(Math.abs(crumbs.x - title!.x)).toBeLessThan(1.5);
      expect(crumbs.y + crumbs.height).toBeLessThanOrEqual(title!.y + 1);
      expect(title!.y - (crumbs.y + crumbs.height)).toBeLessThan(24);
      if (!beside) expect(crumbs.y).toBeGreaterThanOrEqual(art.y + art.height);

      if (viewport.width > 900) {
        // On the header's edges: the words on the left one, which is the left rail's, so the head
        // is not indented into empty space; the picture ends on the right one.
        const header = await box(page, ".site-header");
        const rail = await box(page, "[data-article-rail]");
        expect(Math.abs(copy.x - header.x)).toBeLessThan(1.5);
        expect(Math.abs(rail.x - header.x)).toBeLessThan(1.5);
        expect(Math.abs(art.x + art.width - (header.x + header.width))).toBeLessThan(1.5);
        if (!beside) expect(Math.abs(art.x - header.x)).toBeLessThan(1.5);
      } else {
        // One column: the words on the reading column's edge.
        const text = await box(page, "[data-prose] > p");
        expect(Math.abs(copy.x - text.x)).toBeLessThan(1.5);
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
