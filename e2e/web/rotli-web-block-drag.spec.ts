// Moving a block with its grip (editor/blockHandles.ts) writes exactly the
// moved note into the vault's file: the block lands whole where the drop line
// showed — before a block, on the blank line before one, or at the end of the
// note — and no blank lines pile up where it left (2026-09-23: a block
// dragged down split the text it landed in mid-word).

import { expect, type Page, test } from "@playwright/test";

import { readOpfsFile, startWithFolder } from "./support";

const NOTE = "# Moves\n\nFirst paragraph.\n\n- item one\n- item two\n\nSecond paragraph.\n\nlast line\n";

const body = async (page: Page) =>
  (await readOpfsFile(page, "moves.md")).replace(/^---\n[\s\S]*?\n---\n/, "");

/** Press the hovered block's grip and drag it to a point over the editor. */
async function dragBlock(page: Page, source: string, to: { x: number; y: number }): Promise<void> {
  const line = page.locator(".cm-content .cm-line", { hasText: source }).first();
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  const grip = page.locator(".cm-block-handle.on .cm-bh-grip");
  const handle = (await grip.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 10, handle.y + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.locator(".cm-block-dropline")).toBeVisible();
  await page.mouse.up();
}

async function lineCenter(page: Page, text: string) {
  const box = (await page.locator(".cm-content .cm-line", { hasText: text }).first().boundingBox())!;
  return { x: box.x + 40, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await startWithFolder(page, { "moves.md": NOTE });
  await expect(page.locator(".cm-content").first()).toContainText("Second paragraph.");
});

test("a block dragged down lands whole before the block it's dropped on", async ({ page }) => {
  await dragBlock(page, "First paragraph.", await lineCenter(page, "Second paragraph."));
  await expect
    .poll(() => body(page))
    .toBe("# Moves\n\n- item one\n- item two\n\nFirst paragraph.\n\nSecond paragraph.\n\nlast line\n");
});

test("a block dropped below the last line goes to the end of the note", async ({ page }) => {
  const last = await lineCenter(page, "last line");
  await dragBlock(page, "First paragraph.", { x: last.x, y: last.y + 60 });
  await expect
    .poll(() => body(page))
    .toBe("# Moves\n\n- item one\n- item two\n\nSecond paragraph.\n\nlast line\n\nFirst paragraph.\n");
});

test("the last block dragged up leaves no blank lines behind", async ({ page }) => {
  await dragBlock(page, "last line", await lineCenter(page, "First paragraph."));
  await expect
    .poll(() => body(page))
    .toBe("# Moves\n\nlast line\n\nFirst paragraph.\n\n- item one\n- item two\n\nSecond paragraph.\n");
});
