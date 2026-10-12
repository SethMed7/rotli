// A folder connected straight through the browser has no file watcher: a note
// another app writes into it appears when the tab comes back into focus, with
// no reload (the Mac app's watcher does the same on its side).

import { expect, test } from "@playwright/test";

import { plantOpfsFiles, startWithVault } from "./support";

test("a note written into the folder behind the page's back lists once the tab regains focus", async ({
  page,
}) => {
  await startWithVault(page);
  await page.locator("[role=option]", { hasText: "All notes" }).first().click();
  await expect(page.getByText("Written elsewhere")).toHaveCount(0);
  await plantOpfsFiles(page, {
    "wiki/_inbox/written-elsewhere.md": "# Written elsewhere\n\nby another app\n",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Written elsewhere").first()).toBeVisible();
});
