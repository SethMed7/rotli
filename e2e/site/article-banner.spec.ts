// The top of an article (WritingPage `article`, blog/ArticleBanner.astro and blog/ArticleCover.astro;
// the owner, 2026-10-09, pointing at deno.com/blog: "one thing straight across top like an
// image/banner then the rest under instead of text left illustration right"). The post's picture
// is a band straight across the window, directly under the header, edge to edge and square
// cornered, outside the page's wrapper: from 701px the wide scene cropped off the sky (nothing cut
// at the sides), at 700px and below the phone crop, whole. Under it, on the reading column (the
// left rail's room beside it stays empty from 901px), "Blog /", the title, the summary, the meta
// line, and the topics, then the head's hairline. Still as the page scrolls, contrast measured,
// the title in the first window. /privacy/ opens the same way (privacy-page.spec.ts).
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
  { width: 701, height: 900 },
  { width: 700, height: 900 },
  { width: 390, height: 844 },
];
/** Where the banner shows the phone crop (blog/ArticleBanner.astro). */
const PHONE = 700;
const REM = 16;

for (const path of POSTS) {
  for (const viewport of POST_VIEWPORTS) {
    test(`${path} opens on its banner straight across the top, the title under it (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(path);
      // The banner: straight across the window under the header, edge to edge, outside the page's
      // wrapper, square cornered with a hairline under it.
      const bar = await box(page, ".site-header-bar");
      const art = await box(page, "[data-article-art]");
      const windowWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(Math.abs(art.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(art.width - windowWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(art.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
      await expect(page.locator("main [data-article-art]")).toHaveCount(0);
      await expect(page.locator("[data-article-cover] [data-article-art]")).toHaveCount(0);
      const frame = await page.locator("[data-article-art]").evaluate((el) => ({
        radius: getComputedStyle(el).borderTopLeftRadius,
        rule: getComputedStyle(el).borderBottomWidth,
      }));
      expect(frame).toEqual({ radius: "0px", rule: "1px" });
      const img = page.locator("[data-article-art] img");
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
      expect((await img.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(20);

      // The right picture for the width, and the quokka never cut.
      const shape = await img.evaluate((el: HTMLImageElement) => ({
        src: el.currentSrc,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        natural: el.naturalWidth / el.naturalHeight,
        fit: getComputedStyle(el).objectFit,
        position: getComputedStyle(el).objectPosition,
      }));
      expect(shape.fit).toBe("cover");
      // Never taller than the scene at the window's width, so the crop only ever comes off the top
      // and bottom, never the sides.
      expect(shape.height).toBeLessThanOrEqual(shape.width / shape.natural + 1);
      if (viewport.width > PHONE) {
        // The wide scene, in a band that follows the window's width: clamp(13rem, 36vw, 34rem).
        expect(shape.src).toMatch(/\.webp$/);
        expect(shape.src).not.toMatch(/-mobile\.webp$/);
        const band = Math.min(Math.max(13 * REM, 0.36 * windowWidth), 34 * REM);
        expect(Math.abs(shape.height - band)).toBeLessThanOrEqual(1.5);
        // Most of the crop comes off the sky, so the quokka keeps its feet on the sand.
        expect(parseFloat(shape.position.split(" ")[1]!)).toBeGreaterThanOrEqual(75);
      } else {
        // The phone crop, whole: drawn at its own shape.
        expect(shape.src).toMatch(/-mobile\.webp$/);
        expect(Math.abs(shape.width / shape.height - shape.natural)).toBeLessThan(0.02);
      }

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

      // Nothing over the picture: the words, all of them, under it.
      const copy = await box(page, "[data-article-cover] .head-copy");
      expect(copy.y).toBeGreaterThanOrEqual(art.y + art.height);
      // The title is in the first window.
      expect(title!.y + title!.height).toBeLessThanOrEqual(viewport.height);

      // "Blog /" is part of the head: straight above the title, on its edge, nothing beside it.
      const crumbs = await box(page, "[data-article-cover] .head-copy .crumbs");
      expect(Math.abs(crumbs.x - title!.x)).toBeLessThan(1.5);
      expect(crumbs.y + crumbs.height).toBeLessThanOrEqual(title!.y + 1);
      expect(title!.y - (crumbs.y + crumbs.height)).toBeLessThan(24);
      expect(crumbs.y).toBeGreaterThanOrEqual(art.y + art.height);

      // The words are on the reading column at every width: they start where the post's words do.
      const column = await box(page, "[data-prose] > p");
      expect(Math.abs(copy.x - column.x)).toBeLessThan(1.5);
      const header = await box(page, ".site-header");
      if (viewport.width > 900) {
        // Past the left rail, which is on the header's left edge: its room beside the head stays
        // empty, as the column's own margin.
        const rail = await box(page, "[data-article-rail]");
        expect(Math.abs(rail.x - header.x)).toBeLessThan(1.5);
        expect(copy.x).toBeGreaterThanOrEqual(rail.x + rail.width);
      } else {
        // No rail: the column, and so the words, start on the page's left edge.
        expect(Math.abs(copy.x - header.x)).toBeLessThan(1.5);
      }
      // The hairline under the head is the words' own, not the full header's.
      const rules = await page.evaluate(() => ({
        copy: getComputedStyle(document.querySelector("[data-article-cover] .head-copy")!).borderBottomWidth,
        cover: getComputedStyle(document.querySelector("[data-article-cover]")!).borderBottomWidth,
      }));
      expect(rules).toEqual({ copy: "1px", cover: "0px" });

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
