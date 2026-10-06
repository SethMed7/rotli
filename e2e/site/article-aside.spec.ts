// The end of a blog post: "More from rotli" (blog/ArticleAside.astro). The owner, 2026-10-06:
// "remove the part on right ... stuff on right can go at end of blog in replace of sources since
// sources is already on left side". So there is no right rail at any width: after the article, on
// the reading column's edges, other posts (never the one being read; announced posts only to fill
// in, not links) and two "From rotli" spots (src/promos.ts, rotli's own, local art, first-party
// links). Where the left rail lists the sources (from 901px), it takes the place of the article's
// own Sources list; below that the article keeps its list. Nothing overlaps or overflows from 320
// to 2560, the footer included (the full width sweep is e2e/site/article-width.spec.ts).
import { expect, test, type Page } from "@playwright/test";

const POST = "/blog/the-ai-you-already-pay-for/";
const POSTS = [
  POST,
  "/blog/rotli-web-and-your-mac/",
  "/blog/why-local/",
  "/blog/web-and-mac/",
  "/blog/rotli-helper/",
  "/blog/ai-and-your-notes/",
  "/blog/getting-started/",
];

const more = (page: Page) => page.locator("[data-article-more]");

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

for (const viewport of [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`"More from rotli" closes the post: more posts and two spots, no right rail (${viewport.width}px)`, async ({
    page,
  }) => {
    const elsewhere: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith("http://127.0.0.1")) elsewhere.push(request.url());
    });
    await page.setViewportSize(viewport);
    await page.goto(POST);
    const aside = more(page);
    await expect(aside.getByRole("heading", { level: 2, name: "More from rotli" })).toBeVisible();
    // After the article, on the reading column's edges: nothing beside the text on its right.
    const prose = (await page.locator("[data-prose]").boundingBox())!;
    const text = (await page.locator("[data-prose] > p").first().boundingBox())!;
    const box = (await aside.boundingBox())!;
    expect(box.y).toBeGreaterThan(prose.y + prose.height);
    expect(Math.abs(box.x - text.x)).toBeLessThan(1.5);
    expect(Math.abs(box.x + box.width - (text.x + text.width))).toBeLessThan(1.5);
    const header = (await page.locator(".site-header").boundingBox())!;
    expect(prose.x + prose.width).toBeLessThanOrEqual(header.x + header.width + 1.5);

    // More posts: never this one; published ones link with a date, announced ones say so.
    const posts = aside.locator("[data-more-posts] li");
    expect(await posts.count()).toBeGreaterThanOrEqual(2);
    expect(await posts.count()).toBeLessThanOrEqual(3);
    for (const post of await posts.all()) await expect(post).toBeVisible();
    await expect(aside.locator(`a[href="${POST}"]`)).toHaveCount(0);
    const published = aside.locator('[data-more-post="published"]');
    expect(await published.count()).toBeGreaterThan(0);
    for (const item of await published.all()) {
      await expect(item.locator("a")).toHaveAttribute("href", /^\/blog\/[^/]+\/$/);
      await expect(item.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
    }
    for (const item of await aside.locator('[data-more-post="soon"]').all()) {
      await expect(item).toContainText("Coming soon");
      await expect(item.locator("a")).toHaveCount(0);
    }
    // Published posts come before announced ones.
    const kinds = await posts.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-more-post")),
    );
    expect(kinds.indexOf("soon") === -1 || kinds.lastIndexOf("published") < kinds.indexOf("soon")).toBe(true);

    // The spots: two, each labelled as rotli's own, a local picture, a first-party link.
    const spots = aside.locator("[data-promos] li");
    await expect(spots).toHaveCount(2);
    for (const spot of await spots.all()) {
      await expect(spot).toBeVisible();
      await expect(spot.locator(".promo-label")).toHaveText("From rotli");
      const link = spot.locator("a");
      const href = (await link.getAttribute("href"))!;
      const target = new URL(href, page.url());
      expect(target.origin === new URL(page.url()).origin || target.hostname.endsWith("rotli.co")).toBe(true);
      expect((await link.getAttribute("rel")) ?? "").not.toMatch(/sponsored/);
      const img = spot.locator("img");
      expect(new URL((await img.getAttribute("src"))!, page.url()).origin).toBe(new URL(page.url()).origin);
    }
    await expect(aside.locator("iframe, script")).toHaveCount(0);

    // In place of the article's own Sources list where the rail lists them; after it, and after
    // Share, where the rail has folded away.
    if (viewport.width >= 901) {
      await expect(page.locator("[data-prose] h2#sources")).toBeHidden();
      await expect(page.locator("[data-prose] h2#sources + ol")).toBeHidden();
    } else {
      const sources = (await page.locator("[data-prose] h2#sources + ol").boundingBox())!;
      expect(box.y).toBeGreaterThan(sources.y + sources.height);
      const share = (await page.locator("[data-share]").boundingBox())!;
      expect(box.y).toBeGreaterThan(share.y + share.height);
    }
    // Before the footer.
    const footer = (await page.locator(".site-footer-shell").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(footer.y);
    // Only this site's own files were asked for by the article and its end.
    expect(elsewhere.filter((url) => !/launchllama/.test(url))).toEqual([]);
  });
}

test("across the blog, every spot this build offers is shown on some post", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = new Set<string>();
  for (const path of POSTS) {
    await page.goto(path);
    for (const id of await page
      .locator("[data-promos] li")
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-promo")!)))
      seen.add(id);
  }
  // This lane builds with downloads and without Rotli Web (playwright.site.config.ts).
  expect([...seen].sort()).toEqual(["download", "newsletter", "roadmap", "studio"]);
  expect(seen.has("web")).toBe(false);
});

test("the newsletter spot goes to the sign-up at the foot of the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/rotli-web-and-your-mac/");
  const spot = more(page).locator('[data-promo="newsletter"] a');
  await expect(spot).toHaveAttribute("href", "#newsletter");
  await spot.click();
  await expect(page.locator("#newsletter")).toBeInViewport();
});

for (const width of [320, 390, 768, 1024, 1280, 1360, 1440, 1920, 2560]) {
  test(`a post neither overlaps nor overflows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(POST);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
    const parts = [
      "[data-article-cover]",
      "[data-article-rail]",
      "[data-prose]",
      "[data-article-more]",
      ".site-footer-shell",
    ];
    const boxes = [];
    for (const selector of parts) {
      const box = await page.locator(selector).boundingBox();
      if (box && box.width > 0 && box.height > 0) boxes.push({ selector, box });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!.box, boxes[j]!.box), `${boxes[i]!.selector} × ${boxes[j]!.selector}`).toBe(
          false,
        );
      }
    }
  });
}

test("the Rotli Studio spot links to the studio with a local picture and an outward arrow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of POSTS) {
    await page.goto(path);
    const spot = more(page).locator('[data-promo="studio"]');
    if ((await spot.count()) === 0) continue;
    await expect(spot).toBeVisible();
    const link = spot.locator("a");
    await expect(link).toHaveAttribute("href", "https://studio.rotli.co/");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link).toContainText("Rotli Studio");
    await expect(link.locator(".external-mark")).toHaveText("↗");
    await expect(spot.locator(".promo-label")).toHaveText("From rotli");
    const img = spot.locator("img");
    expect(new URL((await img.getAttribute("src"))!, page.url()).origin).toBe(new URL(page.url()).origin);
    // At the end of the post, so the lazy picture loads once it is scrolled to.
    await spot.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    return;
  }
  throw new Error("no post shows the Rotli Studio spot");
});
