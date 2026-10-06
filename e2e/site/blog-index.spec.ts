// /blog/: the newest post as the feature, the rest in a grid, every entry with its thumbnail
// (the post's scene from build:brand-images), one aspect ratio, real sizes, and the announced
// posts marked "Coming soon" on their picture. A post's page opens on the same scene, composed wide.
import { expect, test, type Locator } from "@playwright/test";

async function expectThumbnail(img: Locator) {
  await expect(img).toHaveAttribute("width", "1200");
  await expect(img).toHaveAttribute("height", "630");
  expect((await img.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(20);
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  const box = (await img.boundingBox())!;
  expect(Math.abs(box.width / box.height - 1200 / 630)).toBeLessThan(0.02);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`the blog index features the newest post and pictures every post (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/blog/");
    const feature = page.locator(".featured a");
    await expect(feature).toHaveAttribute("href", /^\/blog\/[^/]+\/$/);
    await expect(feature.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(feature.locator(".meta")).toContainText("min read");
    const featureImg = feature.locator("img");
    await expect(featureImg).toHaveAttribute("loading", "eager");
    await expectThumbnail(featureImg);

    const tiles = page.locator(".grid > li");
    expect(await tiles.count()).toBeGreaterThan(0);
    for (const tile of await tiles.all()) {
      const img = tile.locator("img");
      await expect(img).toHaveAttribute("loading", "lazy");
      await expectThumbnail(img);
      // An announced post is not a link, and says so on its picture.
      if ((await tile.locator("a").count()) === 0)
        await expect(tile.locator(".badge")).toHaveText("Coming soon");
    }
    await expect(page.locator(".grid .badge").first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
}

test("a post opens on its banner: the same scene as its thumbnail, composed wide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/");
  const tile = page.locator('a[href="/blog/rotli-web-and-your-mac/"] img').first();
  const tileAlt = await tile.getAttribute("alt");
  await page.goto("/blog/rotli-web-and-your-mac/");
  const art = page.locator("[data-article-banner] img");
  await expect(art).toHaveAttribute("width", "2400");
  await expect(art).toHaveAttribute("height", "1000");
  await expect(art).toHaveAttribute("src", "/banners/blog/rotli-web-and-your-mac.webp");
  await expect(art).toHaveAttribute("alt", tileAlt!);
  await expect(page.locator("[data-article-banner] source")).toHaveAttribute(
    "srcset",
    "/banners/blog/rotli-web-and-your-mac-mobile.webp",
  );
  await expect(page.locator(".writing-head .cover")).toHaveCount(0);
});
