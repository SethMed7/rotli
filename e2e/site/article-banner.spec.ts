// The article banner (WritingPage `banner`) on blog posts and /privacy/: a full-width picture
// under the header that takes most of the first window, a head panel on the page's ground
// whose title and date are in that first window at full contrast, the page rising over the
// pinned banner as it scrolls (the meter and the tree still pinned and clear of each other),
// and a still banner when reduced motion is asked for.
import { expect, test, type Page } from "@playwright/test";

const POST = "/blog/rotli-web-and-your-mac/";
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
    const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const colours = (page: Page, text: string, ground: string) =>
  page.evaluate(
    ([textSel, groundSel]) => ({
      fg: getComputedStyle(document.querySelector(textSel)!).color,
      bg: getComputedStyle(document.querySelector(groundSel)!).backgroundColor,
    }),
    [text, ground],
  );

async function box(page: Page, selector: string) {
  return (await page.locator(selector).first().boundingBox())!;
}

for (const path of [POST, "/blog/the-ai-you-already-pay-for/", "/privacy/"]) {
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
      if (path !== "/privacy/") {
        const img = page.locator("[data-article-banner] img");
        await expect
          .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
          .toBe(true);
        expect((await img.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(20);
      }

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
      ([x, y]) => !document.elementFromPoint(x, y)?.closest("[data-article-banner]"),
      [720, banner.y + banner.height / 2],
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

test("the post's banner settles as the page scrolls, and stays still under reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const art = page.locator("[data-article-banner] img");
  const transformAt = async (y: number) => {
    await page.evaluate((top) => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, top);
    }, y);
    await page.waitForTimeout(150);
    return art.evaluate((el) => getComputedStyle(el).transform);
  };
  await page.goto(POST);
  expect(await transformAt(0)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  expect(await transformAt(400)).not.toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(POST);
  expect(await art.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await transformAt(400)).toBe("none");
});
