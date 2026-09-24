import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

const LONG_NOTE = Array.from(
  { length: 120 },
  (_, index) => `Paragraph ${index + 1}: enough text to make the Markdown canvas scroll.`,
).join("\n\n");

async function makeLongNote(page: Page) {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(LONG_NOTE);
  return page.locator(".cm-scroller").last();
}

test("the floating arrow returns a scrolled Markdown note to the top", async ({ page }) => {
  const scroller = await makeLongNote(page);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });

  const scrollToTop = page.getByRole("button", { name: "Scroll to top" });
  await expect(scrollToTop).toBeVisible();
  await scrollToTop.click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(2);
});

test("showing metadata returns a scrolled Markdown note to the top", async ({ page }) => {
  const scroller = await makeLongNote(page);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Show metadata" }).click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(2);
});

// 2026-09-23: in a narrow window the centered format bar ran under and over
// the arrow in the bottom-right corner. At every width the two must not touch.
test("the arrow never overlaps the format bar, at any width", async ({ page }) => {
  await page.goto("/?window=quick");
  await page.locator(".quick-window").getByRole("button", { name: "New note" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(LONG_NOTE);
  const scroller = page.locator(".cm-scroller");
  const bar = page.locator(".fmtbar");
  const arrow = page.getByRole("button", { name: "Scroll to top" });
  for (const width of [900, 620, 540, 500, 470, 430, 380, 340]) {
    await page.setViewportSize({ width, height: 640 });
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(arrow).toBeVisible();
    await expect(bar).toBeVisible();
    await expect
      .poll(async () => {
        const [a, b] = [await arrow.boundingBox(), await bar.boundingBox()];
        if (!a || !b) return "unmeasured";
        const apart =
          a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height;
        return apart ? "apart" : `overlap at ${width}px`;
      })
      .toBe("apart");
  }
});
