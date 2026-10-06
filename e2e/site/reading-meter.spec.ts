// The reading meter pinned under the header (WritingPage `progress`) on /privacy/: it measures the
// article (not the footer), reads 0% at the start and 100% at the article's end, follows the table
// of contents, and hides when the whole article fits in the window. Blog posts (the guides among
// them since 2026-10-06) carry the same measure in their rail and, on a phone, as a slim bar
// (article-rail.spec.ts).
import { expect, test, type Page } from "@playwright/test";

const percent = (page: Page, selector = "[data-read-progress]") =>
  page.locator(selector).first().getAttribute("aria-valuenow").then(Number);

// The page scrolls smoothly: wait until a jump has come to rest before measuring where it landed.
async function settled(page: Page) {
  await expect
    .poll(async () => {
      const before = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(150);
      return (await page.evaluate(() => window.scrollY)) === before;
    })
    .toBe(true);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`/privacy/ carries the reading meter, 0% to 100%, pinned under the header (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/privacy/");
    const meter = page.locator("[data-read-progress]");
    await expect(meter).toBeVisible();
    await expect(meter.locator("[data-read-percent]")).toHaveText("0%");
    // The last line of the article in view: 100%, and on into the footer it stays there.
    await page.evaluate(() => {
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 2);
    });
    await expect.poll(() => percent(page)).toBe(100);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => percent(page)).toBe(100);
    // Pinned under the header while the article scrolls by.
    await page.evaluate(() => {
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 3);
    });
    await expect.poll(() => percent(page)).toBeLessThan(100);
    const header = (await page.locator(".site-header-bar").boundingBox())!;
    const pinned = (await meter.boundingBox())!;
    expect(Math.abs(pinned.y - (header.y + header.height))).toBeLessThan(2);
  });
}

test("a jump through the table of contents moves the meter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/privacy/");
  const links = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
  await links.last().click();
  await expect.poll(() => percent(page)).toBeGreaterThan(50);
  await links.first().click();
  await expect.poll(() => percent(page)).toBeLessThan(50);
});

test("an article that fits in the window shows no meter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 9000 });
  await page.goto("/blog/why-local/");
  await expect(page.locator("[data-prose]")).toBeVisible();
  for (const meter of await page.locator("[data-read-progress]").all()) await expect(meter).toBeHidden();
});

// The sticky "On this page" tree and every jump target clear the pinned header and meter
// (the owner's 2026-10-05 screenshot: the meter covered the tree's label), at the start,
// mid-article, and after a jump (a post's rail: article-rail.spec.ts).
test("/privacy/: the tree's heading and its jump targets sit below the meter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/privacy/");
  const meter = page.locator("[data-read-progress]");
  const label = page.locator("[data-toc] > p");
  await expect(label).toHaveText("On this page");
  const meterBottom = async () => {
    const box = (await meter.boundingBox())!;
    return box.y + box.height;
  };
  const clears = async () => {
    const box = (await label.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual((await meterBottom()) + 8);
  };
  await expect(meter).toBeVisible();
  await clears();
  await page.evaluate(() => {
    const prose = document.querySelector<HTMLElement>("[data-prose]")!;
    window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 2);
  });
  await settled(page);
  await clears();
  const links = page.locator("[data-toc] a");
  for (const index of [1, (await links.count()) - 2]) {
    const link = links.nth(index);
    const id = decodeURIComponent((await link.getAttribute("href"))!.slice(1));
    await link.click();
    await settled(page);
    const landed = (await page.locator(`[id="${id}"]`).boundingBox())!.y;
    expect(landed).toBeLessThan(400);
    expect(landed).toBeGreaterThanOrEqual(await meterBottom());
    await clears();
  }
});

test("on a phone, a jump from /privacy/'s compact tree lands below the meter", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy/");
  const compact = page.locator(".toc-compact");
  await compact.locator("summary").click();
  const link = compact.locator("a").nth(2);
  const id = decodeURIComponent((await link.getAttribute("href"))!.slice(1));
  await link.click();
  await settled(page);
  const target = (await page.locator(`[id="${id}"]`).boundingBox())!.y;
  expect(target).toBeLessThan(400);
  const meter = (await page.locator("[data-read-progress]").boundingBox())!;
  expect(target).toBeGreaterThanOrEqual(meter.y + meter.height);
});
