// The launch paint (system audit 2026-09-01 §8d, item 1): index.html pins the
// light theme, and the window is visible while settings hydrate, so a
// dark-theme person saw a light ground first. public/theme-boot.js now applies
// the theme the last launch remembered before anything paints. The browser
// twin keeps settings in memory and never writes the key, so this seeds it the
// way the Mac app or Rotli Web leaves it.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the theme the last launch applied paints first, before the app mounts", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("rotli.lastDataTheme", "midnight-dark");
    // what the page looks like as soon as the head has run, before React
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const html = document.documentElement;
        (window as unknown as { firstPaint: object }).firstPaint = {
          theme: html.dataset.theme,
          mounted: (document.getElementById("root")?.childElementCount ?? 0) > 0,
        };
      },
      { once: true },
    );
  });
  await gotoApp(page);
  const first = await page.evaluate(
    () => (window as unknown as { firstPaint: { theme: string; mounted: boolean } }).firstPaint,
  );
  expect(first.mounted).toBe(false);
  expect(first.theme).toBe("midnight-dark");
});

test("with nothing remembered, or something that isn't a theme, launch stays on the light default", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("seeded")) {
      window.localStorage.setItem("rotli.lastDataTheme", "not-a-theme");
      window.sessionStorage.setItem("seeded", "1");
    }
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        (window as unknown as { firstTheme: string }).firstTheme =
          document.documentElement.dataset.theme ?? "";
      },
      { once: true },
    );
  });
  await gotoApp(page);
  expect(await page.evaluate(() => (window as unknown as { firstTheme: string }).firstTheme)).toBe("light");
  // the in-memory twin isn't durable, so it never writes the key itself
  expect(await page.evaluate(() => window.localStorage.getItem("rotli.lastDataTheme"))).toBe("not-a-theme");
});
