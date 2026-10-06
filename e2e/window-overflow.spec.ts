// The window never scrolls sideways (2026-10-06). Two hover labels — the
// title bar's theme button and a tab strip's + — sat centred on buttons near
// the right edge and reached 50 px past the window, so the page was wider than
// the window and a ⌘K pick scrolled it sideways. Every hover label must stay
// inside the window, whatever its width.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

for (const width of [1280, 900]) {
  test(`at ${width} px nothing reaches past the window and a ⌘K pick doesn't scroll it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await gotoApp(page);

    const outside = await page.evaluate(() => {
      const right = document.documentElement.clientWidth;
      return [...document.querySelectorAll(".tip")]
        .filter((tip) => {
          const box = tip.getBoundingClientRect();
          return box.width > 0 && (box.right > right + 0.5 || box.left < -0.5);
        })
        .map((tip) => tip.textContent);
    });
    expect(outside).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    await page.getByRole("button", { name: /Search notes and actions/ }).click();
    await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Pricing");
    await page.locator(".prow", { hasText: "Pricing decision" }).first().click();
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
}
