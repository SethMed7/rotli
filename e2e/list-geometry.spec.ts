// List geometry the owner reads every day (2026-09-17 review): a wrapped
// list line lands its second row under the first row's TEXT (never a step
// to the right of it), and the subtask "0/1" pill a parent task carries stays
// inside its own box instead of printing over the words before it.

import { expect, type Page, test } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 900, height: 700 } });

const LONG =
  "copy paste when I copy a whole chat and paste it into a new one it does not render like the previous one did, so copy the raw markdown instead";

const NOTE = `# Geometry

- [ ] ${LONG}
- ${LONG}
1. ${LONG}
- [x] parent task with a child
  - [ ] the child
- ( ) ${LONG}
`;

/** Left edges (px) of a rendered line's first text row and its last text row. */
async function textRowLefts(page: Page, lineIndex: number): Promise<{ first: number; last: number }> {
  return page.evaluate((index) => {
    const line = document.querySelectorAll(".cm-content .cm-line")[index];
    if (!line) throw new Error(`no line ${index}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      // widget text (a bullet glyph, a number, a pill) is not the line's prose
      if (text.parentElement?.closest(".rotli-marker, .rotli-check-wrap, .rotli-choice, .rotli-progress"))
        continue;
      if (text.data.trim()) texts.push(text);
    }
    if (texts.length === 0) throw new Error(`line ${index} has no prose`);
    const range = document.createRange();
    range.setStart(texts[0]!, 0);
    range.setEnd(texts[texts.length - 1]!, texts[texts.length - 1]!.data.length);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (rects.length < 2) throw new Error(`line ${index} did not wrap (${rects.length} rects)`);
    rects.sort((a, b) => a.top - b.top);
    return { first: rects[0]!.left, last: rects[rects.length - 1]!.left };
  }, lineIndex);
}

test("a wrapped task, bullet, and numbered line align their rows under the text", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(NOTE);
  // park the caret on the heading so every list line renders its widget
  await page.locator(".cm-content .cm-line").first().click();
  await expect(page.locator(".rotli-check")).toHaveCount(3);

  for (const [index, kind] of [
    [2, "task"],
    [3, "bullet"],
    [4, "numbered"],
    [7, "choice"],
  ] as const) {
    const { first, last } = await textRowLefts(page, index);
    expect(
      Math.abs(first - last),
      `${kind} line: first row at ${first}, wrapped row at ${last}`,
    ).toBeLessThan(1.5);
  }
});

test("a parent task's subtask pill keeps its digits inside the pill", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(NOTE);
  await page.locator(".cm-content .cm-line").first().click();

  const pill = page.locator(".rotli-progress");
  await expect(pill).toHaveText("0/1");
  const offset = await pill.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return text.left - box.left;
  });
  expect(offset, `digits start ${offset}px from the pill's left edge`).toBeGreaterThanOrEqual(0);
});
