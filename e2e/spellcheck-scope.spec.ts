// Spellcheck belongs to prose. Code, link targets, and fenced lines opt out, so
// the system checker never underlines syntax; ordinary words keep it. (Whether
// macOS draws every squiggle it should is native behaviour this lane cannot see.)
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("code, links, and fenced lines opt out of spellcheck; prose keeps it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "New folder in Main" }).waitFor();
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("run `bunx oxfmt` then see [[launch-notez]] okay");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("plain wrods here");

  await expect(editor).toHaveAttribute("spellcheck", "true");
  await expect(page.locator(".rotli-code", { hasText: "bunx oxfmt" })).toHaveAttribute("spellcheck", "false");
  await expect(page.locator(".rotli-wikilink", { hasText: "launch-notez" })).toHaveAttribute(
    "spellcheck",
    "false",
  );
  // an ordinary line carries no opt-out of its own: it inherits the editor's
  const prose = page.locator(".cm-line", { hasText: "plain wrods here" });
  await expect(prose).not.toHaveAttribute("spellcheck", "false");
  // the seeded note's ".md" literal is code too
  await expect(page.locator(".rotli-code").first()).toHaveAttribute("spellcheck", "false");
});
