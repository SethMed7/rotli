// A Main row dragged DOWN the list lands where it was aimed (1.3.0). The drag
// chip used to hang under the pointer, so its middle sat most of a row below
// the line the drop is hit-tested at — aim with the chip and the item landed
// one slot too high. The shared helper crosses the threshold sideways and
// never measures the chip, so this spec drives a real vertical drag.

import { expect, type Page, test } from "@playwright/test";

import { gotoApp } from "./support";

async function newNote(page: Page, title: string): Promise<void> {
  await page.keyboard.press("Meta+T");
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText(`# ${title}\n`);
  await expect(page.locator(".main-tree .main-row", { hasText: title }).first()).toBeVisible();
}

test("the drag chip is centred on the drop line, and the row lands under the pointer", async ({ page }) => {
  await gotoApp(page);
  for (const title of ["Aim one", "Aim two", "Aim three"]) await newNote(page, title);

  const rows = page.locator(".main-tree .main-row");
  const titles = async () =>
    (await rows.allInnerTexts()).map((text) => text.trim()).filter((text) => text.startsWith("Aim"));
  const before = await titles();
  expect(before).toHaveLength(3);

  const source = rows.filter({ hasText: before[0] ?? "" }).first();
  const target = rows.filter({ hasText: before[2] ?? "" }).first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Main rows have no geometry");

  // release in the lower quarter of the last row: "after" it
  const x = to.x + to.width / 2;
  const y = to.y + to.height * 0.75;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 14 });

  const chip = await page.locator(".drag-ghost").boundingBox();
  if (!chip) throw new Error("no drag chip while dragging");
  expect(Math.abs(chip.y + chip.height / 2 - y)).toBeLessThanOrEqual(1);
  await expect(target).toHaveClass(/mdrop-after/);

  await page.mouse.up();
  await expect.poll(titles).toEqual([before[1], before[2], before[0]]);
});
