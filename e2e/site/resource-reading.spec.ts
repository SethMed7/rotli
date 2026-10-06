// Resource articles: their own scene, and a reading meter pinned under the header on every
// width that measures the article (not the footer) and follows the table of contents.
import { expect, test, type Page } from "@playwright/test";

const percent = (page: Page) =>
  page.locator("[data-read-progress]").getAttribute("aria-valuenow").then(Number);

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the meter reads 0% at the start and 100% at the article's end (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/resources/rotli-helper/");
    const meter = page.locator("[data-read-progress]");
    await expect(meter).toBeVisible();
    await expect(meter.locator("[data-read-percent]")).toHaveText("0%");
    await expect(page.locator(".rscene.rscene-helper")).toBeVisible();

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
  await page.goto("/resources/rotli-helper/");
  const toc = page.getByRole("navigation", { name: "On this page" });
  const links = toc.getByRole("link");
  await links.last().click();
  await expect.poll(() => percent(page)).toBeGreaterThan(50);
  await links.first().click();
  await expect.poll(() => percent(page)).toBeLessThan(50);
});

test("an article that fits in the window shows no meter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.goto("/resources/why-local/");
  await expect(page.locator(".rscene.rscene-local")).toBeVisible();
  await expect(page.locator("[data-read-progress]")).toBeHidden();
});
