// Phone and tablet widths (390 and 768, plus 1024 for the theme studio's island, and the
// landing from 320 to 1920): nothing widens the page, the theme studio's island never sits under its words, and the landing's
// smaller controls answer a 44px touch. The website prompt pass of 2026-10-05 found each of
// these by sweep; this keeps them found.
import { expect, test } from "@playwright/test";

const overflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [390, 768]) {
  for (const path of [
    "/",
    "/features/",
    "/privacy/",
    "/changelog/",
    "/blog/",
    "/blog/rotli-web-and-your-mac/",
    "/about/",
    "/download/",
    "/roadmap/",
  ]) {
    test(`${path} never scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
}

for (const width of [320, 1024, 1920]) {
  test(`the landing never scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

for (const width of [768, 1024, 1180, 1440]) {
  test(`the theme studio's island stays clear of its lede at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const backdrop = page.locator(".personal .backdrop");
    const lede = (await page.locator(".personal .section-lede").boundingBox())!;
    const box = await backdrop.boundingBox();
    // Hidden, or starting right of the lede's line length.
    if (box !== null) expect(box.x).toBeGreaterThan(lede.x + lede.width);
  });
}

test("each card puts its picture beside its words on a tablet", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  for (const card of await page.locator(".overview .card").all()) {
    const art = (await card.locator(".stage").boundingBox())!;
    const title = (await card.locator("h3").boundingBox())!;
    expect(title.x).toBeGreaterThan(art.x + art.width);
    expect(title.y).toBeGreaterThan(art.y);
    expect(title.y + title.height).toBeLessThan(art.y + art.height);
  }
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("the footnote marks answer a 44px touch", async ({ page }) => {
    await page.goto("/");
    for (const mark of await page.locator(".figures sup a").all()) {
      const box = (await mark.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("a guide's breadcrumb answers a 44px-tall touch", async ({ page }) => {
    await page.goto("/resources/getting-started/");
    expect((await page.locator(".crumbs a").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("the 404's other ways in answer a 44px-tall touch", async ({ page }) => {
    await page.goto("/no-such-page/");
    for (const link of await page.locator(".also a").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
