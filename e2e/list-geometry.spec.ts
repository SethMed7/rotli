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

// The owner, 2026-09-18: "numbers should not go more left than any text could,
// no matter what it is … it needs to respect the same width boundary." Every
// list marker — bullet, number (one digit, two, three), checkbox, choice —
// starts at or right of the note's own text edge. Measured on the GLYPH, not
// the marker's box: an inherited text-indent once drew the digits a whole
// column to the left of a correctly placed box.
test("no list marker starts left of the note's text edge", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  const numbered = Array.from({ length: 12 }, (_, i) => `${i + 1}. item ${i + 1}`).join("\n");
  await page.keyboard.insertText(
    `# Boundary\n\nplain paragraph\n\n${numbered}\n\n100. a hundred\n101. and one\n\n- bullet\n- [ ] task\n- ( ) choice\n`,
  );
  await page.locator(".cm-content .cm-line").first().click();
  const result = await editor.evaluate((content) => {
    const glyphLeft = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 ? rect.left : el.getBoundingClientRect().left;
    };
    const paragraph = [...content.querySelectorAll(".cm-line")].find(
      (l) => l.textContent === "plain paragraph",
    );
    if (!paragraph) throw new Error("no paragraph");
    const edge = glyphLeft(paragraph);
    const markers = [...content.querySelectorAll(".rotli-marker, .rotli-check, .rotli-choice")];
    return {
      edge,
      count: markers.length,
      lefts: markers.map((m) => [m.textContent ?? "", glyphLeft(m)] as const),
    };
  });
  expect(result.count).toBeGreaterThanOrEqual(17);
  for (const [text, left] of result.lefts) {
    expect(left, `marker "${text}" at ${left}, text edge at ${result.edge}`).toBeGreaterThanOrEqual(
      result.edge - 0.75,
    );
  }
});

test("an empty task keeps the caret in text, level with its box, on the text column", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  await page.locator(".cm-content").last().click();
  await page.keyboard.type("Test okay world");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[] ");

  // the caret's own rectangle: a real text position, not a gap beside the widget
  // (2026-09-23: in Zen the caret floated above-right of an empty task's box)
  const caret = () =>
    page.evaluate(() => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const rect = range?.getClientRects()[0];
      const line = selection?.anchorNode?.parentElement?.closest(".cm-line");
      const box = line?.querySelector(".rotli-check")?.getBoundingClientRect();
      return {
        inText: selection?.anchorNode?.nodeType === Node.TEXT_NODE,
        caret: rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null,
        box: box ? { top: box.top, bottom: box.bottom } : null,
      };
    });
  const empty = await caret();
  expect(empty.inText).toBe(true);
  expect(empty.caret).not.toBeNull();
  expect(empty.box).not.toBeNull();
  // vertically: the caret's middle sits within the box
  const middle = (empty.caret!.top + empty.caret!.bottom) / 2;
  expect(middle).toBeGreaterThan(empty.box!.top);
  expect(middle).toBeLessThan(empty.box!.bottom);

  // horizontally: where the first typed letter goes
  await page.keyboard.type("t");
  const typed = await page.evaluate(() => {
    const line = [...document.querySelectorAll(".cm-content .cm-line.rotli-task")].pop();
    const text = [...(line?.childNodes ?? [])].find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 1);
    return range.getBoundingClientRect().left;
  });
  expect(Math.abs(empty.caret!.left - typed)).toBeLessThanOrEqual(1.5);
});
