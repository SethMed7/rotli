// The suite-wide guard (support.ts failOnPageErrors) is itself pinned: a page
// that throws an error nobody catches must fail its test. Marked test.fail(),
// so this spec passes only while the guard keeps catching it.
import { test } from "@playwright/test";

import { gotoApp } from "./support";

test("an uncaught error in the page fails the test that opened it", async ({ page }) => {
  await gotoApp(page);
  // only from here on: a failure to boot must not count as the guard working
  test.fail();
  await page.evaluate(() =>
    setTimeout(() => {
      throw new Error("deliberate uncaught error");
    }, 0),
  );
  await page.waitForTimeout(500);
});
