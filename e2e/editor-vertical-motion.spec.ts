import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoApp } from "./support";

// CodeMirror sizes lines and block widgets by their border box. Anything that
// added a vertical MARGIN (panel rows, the table wrapper) left the height map
// short, so ↑ from the blank lines below a panel or table skipped a line and a
// click below them selected the wrong line. Spacing is measured now; these
// specs pin the motion.

const caretLine = (editor: Locator) =>
  editor.evaluate((el) => {
    const node = document.getSelection()?.anchorNode;
    const lineEl = (node instanceof Element ? node : node?.parentElement)?.closest(".cm-line");
    const lines = Array.from(el.querySelectorAll(".cm-line"));
    return lineEl ? lines.indexOf(lineEl) + 1 : -1;
  });

async function seed(page: Page, text: string) {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(text);
  await page.keyboard.press("End");
  for (const _ of [1, 2, 3]) await page.keyboard.press("Enter");
  return editor;
}

for (const [label, text] of [
  ["a multi-choice panel", "- [##?] Which\n- [##] a\n- [##] but why"],
  ["a table", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
] as const) {
  test(`↑ and clicks below ${label} move one line at a time`, async ({ page }) => {
    const editor = await seed(page, text);
    const lines = editor.locator(".cm-line");
    const total = await lines.count();
    expect(await caretLine(editor)).toBe(total);
    await page.keyboard.press("ArrowUp");
    expect(await caretLine(editor)).toBe(total - 1);
    await page.keyboard.press("ArrowUp");
    expect(await caretLine(editor)).toBe(total - 2);
    // a click at the vertical centre of the middle blank line lands on it
    const middle = lines.nth(total - 2);
    const box = (await middle.boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + box.height / 2);
    expect(await caretLine(editor)).toBe(total - 1);
    const last = (await lines.nth(total - 1).boundingBox())!;
    await page.mouse.click(last.x + 4, last.y + last.height / 2);
    expect(await caretLine(editor)).toBe(total);
  });
}
