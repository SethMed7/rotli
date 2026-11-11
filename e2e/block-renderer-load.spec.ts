// A rendered block whose renderer can't be loaded (offline, or a chunk gone
// after a web deploy) says so, instead of staying blank as if still loading
// (perf audit 2026-07-30: async block renderers swallowed the rejection).
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("a math block whose renderer won't load shows why, and the note stays editable", async ({ page }) => {
  // KaTeX is a lazy chunk: refuse it, the way a stale deploy or no network would
  await page.route(/katex/, (route) => route.abort());
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("Before\n\n```math\nx^2\n```\n\nAfter");
  await page.getByText("Before").click();

  const block = page.locator(".rotli-render-block[data-lang='math']");
  await expect(block.locator(".rotli-render-error")).toContainText("Reload Rotli to try again");
  await expect(editor).toContainText("After");
});
