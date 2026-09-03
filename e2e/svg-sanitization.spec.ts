import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("SVG fences remove active content and external resources before rendering", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { svgActiveContentRan?: boolean }).svgActiveContentRan = false;
  });
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    `# Safe vector\n\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><script>window.svgActiveContentRan=true</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">blocked</div></foreignObject><image href="https://example.test/tracker.png"/><rect width="20" height="20" onload="window.svgActiveContentRan=true" fill="url(https://example.test/paint)"/><circle cx="10" cy="10" r="4" fill="#abc"/></svg>\n\`\`\`\n\nAfter the vector`,
  );
  // scroll, don't chord: Meta+Home is a macOS-only binding (no-op on Linux CI)
  await page
    .locator(".cm-scroller")
    .last()
    .evaluate((el) => {
      el.scrollTop = 0;
    });

  const preview = page.locator(".rotli-render-svg");
  await expect(preview.locator("svg")).toHaveCount(1);
  await expect(preview.locator("circle")).toHaveCount(1);
  // a viewBox-only SVG used to collapse to 0×18 inside the flex card
  await expect
    .poll(async () => (await preview.locator("svg").boundingBox())?.width ?? 0)
    .toBeGreaterThan(100);
  await expect(preview.locator("script, foreignObject, image, [onload], [href], [style]")).toHaveCount(0);
  await expect(preview.locator("rect")).not.toHaveAttribute("fill", /url/);
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { svgActiveContentRan?: boolean }).svgActiveContentRan),
    )
    .toBe(false);
});
