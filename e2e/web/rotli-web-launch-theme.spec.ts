// The launch paint on Rotli Web, end to end through the real controls: pick a
// dark theme, reload, and the page is already dark before the app mounts —
// the theme the app itself remembered (src/state/theme.ts), applied by
// public/theme-boot.js under the /app/ base. The desktop twin's spec seeds the
// key; this one proves the app writes it where settings are durable.
import { expect, test } from "@playwright/test";

import { themeNow } from "../support";
import { startWithVault } from "./support";

test("a dark theme chosen on Rotli Web is the first thing painted after a reload", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        (window as unknown as { firstPaint: object }).firstPaint = {
          theme: document.documentElement.dataset.theme ?? "",
          mounted: (document.getElementById("root")?.childElementCount ?? 0) > 0,
        };
      },
      { once: true },
    );
  });
  await startWithVault(page);

  let chosen = "";
  for (let i = 0; i < 14 && !chosen; i += 1) {
    const toggle = page.getByRole("button", { name: /^Theme — / });
    if (/Dark|Charcoal|Midnight/.test(themeNow(await toggle.getAttribute("aria-label")))) {
      chosen = (await page.evaluate(() => document.documentElement.dataset.theme)) ?? "";
      break;
    }
    await toggle.click();
  }
  expect(chosen).not.toBe("");
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("rotli.lastDataTheme")))
    .toBe(chosen);

  await page.reload();
  await expect(page.locator(".tabstrip").first()).toBeVisible();
  const first = await page.evaluate(
    () => (window as unknown as { firstPaint: { theme: string; mounted: boolean } }).firstPaint,
  );
  expect(first.mounted).toBe(false);
  expect(first.theme).toBe(chosen);
});
