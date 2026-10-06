// /blog/ (blog/BlogIndex.astro, arranged by src/blog.ts): the featured story (its picture large,
// its date, summary, and topics), the next posts in a row, "All posts" as a dated list newest
// first with topic filters (script only; without it the whole list shows), the announced posts
// apart under "Coming soon" and never links, and "New" on posts from the last 14 days of the
// build. Every picture is a real thumbnail at one 1200 × 630 shape. A post opens on the same
// scene, composed wide.
import { expect, test, type Locator, type Page } from "@playwright/test";

const DAY = 24 * 60 * 60 * 1000;

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

/** The list's rows as [date, href], top to bottom. */
const listRows = (page: Page): Promise<[string, string][]> =>
  page
    .locator("[data-post-list] > li")
    .evaluateAll((rows) =>
      rows.map((row): [string, string] => [
        row.querySelector("time")!.getAttribute("datetime")!,
        row.querySelector("a")!.getAttribute("href")!,
      ]),
    );

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`the blog index leads with the featured post, then the row, the list, and Coming soon (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/blog/");
    const feature = page.locator("[data-featured] a");
    await expect(feature).toHaveAttribute("href", /^\/blog\/[^/]+\/$/);
    await expect(feature.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(feature.locator(".meta")).toContainText("min read");
    expect(await feature.locator(".tag").count()).toBeGreaterThan(0);
    const featureImg = feature.locator("img");
    await expect(featureImg).toHaveAttribute("loading", "eager");
    await expectThumbnail(featureImg);

    // The featured post is the newest one (no post is marked `featured` today).
    const rows = await listRows(page);
    expect(rows.length).toBeGreaterThan(1);
    await expect(feature).toHaveAttribute("href", rows[0]![1]);
    // The row under it: the next posts, up to three, never the featured one again.
    const secondary = page.locator("[data-secondary] li a");
    const secondaryHrefs = await secondary.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    );
    expect(secondaryHrefs).toEqual(rows.slice(1, 4).map(([, href]) => href));
    for (const img of await page.locator("[data-secondary] img").all()) await expectThumbnail(img);

    // The section order on the page.
    const order = await page.evaluate(() =>
      ["[data-featured]", "[data-secondary]", "[data-archive]", "[data-upcoming]"].map(
        (selector) => document.querySelector(selector)!.getBoundingClientRect().top + window.scrollY,
      ),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Coming soon: apart, labelled, pictured, and not links.
    const upcoming = page.locator("[data-upcoming]");
    await expect(upcoming.getByRole("heading", { name: "Coming soon" })).toBeVisible();
    expect(await upcoming.locator("li").count()).toBeGreaterThan(0);
    await expect(upcoming.locator("a")).toHaveCount(0);
    for (const img of await upcoming.locator("img").all()) await expectThumbnail(img);
    // ... and never in the featured area or the list.
    const upcomingTitles = await upcoming.locator(".soon-title").allTextContents();
    const listed = await page.locator("[data-featured], [data-secondary], [data-archive]").allTextContents();
    for (const title of upcomingTitles) expect(listed.join(" ")).not.toContain(title);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
}

test("All posts lists every published post newest first, with its date, topic, and summary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/");
  const rows = await listRows(page);
  const dates = rows.map(([date]) => date);
  expect([...dates].sort().reverse()).toEqual(dates);
  for (const row of await page.locator("[data-post-list] > li").all()) {
    await expect(row.locator(".list-topic")).not.toBeEmpty();
    await expect(row.locator(".list-summary")).not.toBeEmpty();
    // Thin rules, no boxes.
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
    expect(await row.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("1px");
  }
});

test("a post is marked New for 14 days after its date, as of the build", async ({ page }) => {
  await page.goto("/blog/");
  // The site was built moments ago, so the build's clock and this one agree to the day.
  for (const row of await page.locator("[data-post-list] > li").all()) {
    const date = new Date(`${await row.locator("time").getAttribute("datetime")}T00:00:00Z`);
    const fresh = Date.now() - date.getTime() < 14 * DAY;
    await expect(row.locator(".new")).toHaveCount(fresh ? 1 : 0);
    if (fresh) await expect(row.locator(".new")).toHaveText("New");
  }
  const featureDate = new Date(
    `${await page.locator("[data-featured] time").getAttribute("datetime")}T00:00:00Z`,
  );
  await expect(page.locator("[data-featured] .new")).toHaveCount(
    Date.now() - featureDate.getTime() < 14 * DAY ? 1 : 0,
  );
});

test("the topic filters narrow the list, say how many, and keep the choice in the address", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/");
  const filters = page.getByRole("group", { name: "Show posts about" });
  await expect(filters).toBeVisible();
  const all = filters.getByRole("button", { name: "All" });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator("[data-post-list] > li");
  const total = await rows.count();

  await filters.getByRole("button", { name: "Rotli Web" }).click();
  await expect(filters.getByRole("button", { name: "Rotli Web" })).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  const visible = page.locator("[data-post-list] > li:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible.locator("a")).toHaveAttribute("href", "/blog/rotli-web-and-your-mac/");
  await expect(page.locator("[data-filter-status]")).toHaveText("1 post about Rotli Web");
  expect(new URL(page.url()).searchParams.get("topic")).toBe("rotli-web");

  // The address brings the choice back.
  await page.reload();
  await expect(page.locator("[data-post-list] > li:visible")).toHaveCount(1);

  await page.getByRole("group", { name: "Show posts about" }).getByRole("button", { name: "All" }).click();
  await expect(page.locator("[data-post-list] > li:visible")).toHaveCount(total);
  expect(new URL(page.url()).searchParams.has("topic")).toBe(false);
});

test("without script there are no filters, and the whole list shows", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/blog/?topic=rotli-web");
  await expect(page.locator("[data-topic-filters]")).toBeHidden();
  const rows = page.locator("[data-post-list] > li");
  expect(await rows.count()).toBeGreaterThan(1);
  for (const row of await rows.all()) await expect(row).toBeVisible();
  await context.close();
});

test("a post opens on its cover: the same scene as its thumbnail, composed wide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/");
  const tile = page
    .locator(
      '[data-secondary] a[href="/blog/rotli-web-and-your-mac/"] img, [data-featured] a[href="/blog/rotli-web-and-your-mac/"] img',
    )
    .first();
  const tileAlt = await tile.getAttribute("alt");
  await page.goto("/blog/rotli-web-and-your-mac/");
  const art = page.locator("[data-article-art] img");
  await expect(art).toHaveAttribute("width", "2400");
  await expect(art).toHaveAttribute("height", "1000");
  await expect(art).toHaveAttribute("src", "/banners/blog/rotli-web-and-your-mac.webp");
  await expect(art).toHaveAttribute("alt", tileAlt!);
  await expect(page.locator("[data-article-art] source")).toHaveAttribute(
    "srcset",
    "/banners/blog/rotli-web-and-your-mac-mobile.webp",
  );
});
