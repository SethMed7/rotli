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
