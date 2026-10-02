// Tab is a real indent (owner request #10, 2026-10-02: "proper tab for like
// indenting in"). Before: a Tab on prose wrote two spaces that live preview
// drew as two space-widths — Tab looked like it did nothing — and a Tab on a
// heading turned it into literal "  ## Heading" text. Now a paragraph takes one
// visible level (its text on a bullet's text column) and stops short of
// Markdown's four-space code block, lists nest a level per press, and a
// heading stays a heading. Pressed with the real Tab key.

import { expect, type Page, test } from "@playwright/test";

import { gotoApp } from "./support";

/** The open note's Markdown, as the editor will save it. */
async function noteText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => new URL(name).pathname === "/src/editor/commands.ts");
    if (!url) throw new Error("the editor commands module is not mounted");
    const { activeEditor } = await import(/* @vite-ignore */ url);
    return activeEditor()?.getSelection?.()?.doc ?? "";
  });
}

/** Left edge (px) of the first visible, non-marker character on a line. */
async function textLeft(page: Page, index: number): Promise<number> {
  return page.evaluate((lineIndex) => {
    const content = [...document.querySelectorAll(".cm-content")].at(-1);
    const line = content?.querySelectorAll(".cm-line")[lineIndex];
    if (!line) throw new Error(`no line ${lineIndex}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (text.parentElement?.closest(".rotli-marker, .rotli-check-wrap")) continue;
      const at = text.data.search(/\S/);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      return range.getBoundingClientRect().left;
    }
    throw new Error(`line ${lineIndex} has no text`);
  }, index);
}

const NOTE =
  "# Indents\n\nflush prose\nindent me\n- bullet one\n- bullet two\n- [ ] task one\n- [ ] task two\n## Section\nend";

test("Tab indents prose visibly, nests lists, and leaves a heading alone", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(NOTE);
  const lines = editor.locator(".cm-line");
  const tabAt = async (index: number, presses = 1) => {
    await lines.nth(index).click();
    await page.keyboard.press("End");
    // a caret mid-text still moves the whole line
    await page.keyboard.press("ArrowLeft");
    for (let i = 0; i < presses; i++) await page.keyboard.press("Tab");
  };

  const flush = await textLeft(page, 2);
  const bulletText = await textLeft(page, 4);

  await tabAt(3, 2); // the second press is consumed and changes nothing
  await tabAt(5);
  await tabAt(7);
  await tabAt(8);
  await lines.nth(9).click(); // park the caret so every line renders

  await expect
    .poll(() => noteText(page))
    .toBe(
      "# Indents\n\nflush prose\n  indent me\n- bullet one\n  - bullet two\n- [ ] task one\n  - [ ] task two\n## Section\nend",
    );

  // the indented paragraph moved right, onto the bullet's text column
  await expect(lines.nth(3)).toHaveClass(/rotli-indented/);
  expect(await textLeft(page, 3)).toBeGreaterThan(flush + 10);
  expect(Math.abs((await textLeft(page, 3)) - bulletText)).toBeLessThan(1.5);
  // nested items step right of their parents
  expect(await textLeft(page, 5)).toBeGreaterThan((await textLeft(page, 4)) + 10);
  expect(await textLeft(page, 7)).toBeGreaterThan((await textLeft(page, 6)) + 10);
  // the heading is still a heading, flush left
  await expect(lines.nth(8)).toHaveClass(/rotli-h2/);
  expect(Math.abs((await textLeft(page, 8)) - flush)).toBeLessThan(1.5);

  // Shift-Tab brings the paragraph back
  await lines.nth(3).click();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => noteText(page)).toContain("\nindent me\n");
  await expect(lines.nth(3)).not.toHaveClass(/rotli-indented/);
});
