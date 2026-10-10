// Getting a note out of a Main folder (the owner, 2026-10-08): with Main one
// open folder and nothing beside it there was no row to drop next to, so a
// note could never leave. The space under the list now takes a nested row out
// while it is dragged, and a note's menu offers Remove from folder. The
// new-folder field also lines its icon up with the folders below it.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

const NOTE = "Q3 priorities — Northstar";
const LATER = "Groceries";

test("a note leaves its folder by drag or by Remove from folder, even when Main is one folder", async ({
  page,
}) => {
  await gotoApp(page);
  // the music player (shown from the first run) sits over the bottom of the sidebar
  await page.getByRole("button", { name: "Hide the player" }).click();
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]').first();
  await pointerDrag(page, page.locator(".recent-row", { hasText: NOTE }), await centerOf(mainRoot));

  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Bundle");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-id="main:Bundle"]');
  await expect(folder).toBeVisible();

  // the new-folder field's icon sits in the same column as a folder row's
  await page.getByRole("button", { name: "New folder in Main" }).click();
  const field = page.getByRole("textbox", { name: "New folder in Main" });
  await expect(field).toBeVisible();
  const fieldIcon = await page.locator(".main-row.renaming svg.kind-folder").boundingBox();
  const folderIcon = await folder.locator("svg.kind-folder").boundingBox();
  expect(Math.abs((fieldIcon?.x ?? 0) - (folderIcon?.x ?? 99))).toBeLessThanOrEqual(1);
  await field.press("Escape");

  // file the note: Main is now one folder holding the only note
  const row = page.locator(".main-tree .main-row", { hasText: NOTE });
  const fileIntoBundle = async () => {
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to folder" }).click();
    await page.getByRole("menuitem", { name: "Bundle" }).click();
    await expect(page.locator(".main-branch-children .main-row", { hasText: NOTE })).toBeVisible();
  };
  await fileIntoBundle();

  // drag it below the list: the drop space appears and takes it out
  const from = await row.boundingBox();
  if (!from) throw new Error("no row geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height + 12, { steps: 6 });
  const strip = page.locator(".main-root-drop");
  await expect(strip).toHaveText("Drop here to take it out of the folder");
  const to = await strip.boundingBox();
  if (!to) throw new Error("no drop-space geometry");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(strip).toHaveClass(/over/);
  await page.mouse.up();
  await expect(page.locator(".main-branch-children .main-row", { hasText: NOTE })).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(strip).toHaveCount(0);

  // with another top-level note after the folder, the drop space lands the
  // note just after its folder, ahead of that note — where Remove from folder
  // puts it (one rule: liftToMainRoot), not at the end of Main
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  // dropped on the folder row's lower edge: the tree reads [Bundle, LATER, NOTE]
  const bundle = await folder.boundingBox();
  if (!bundle) throw new Error("no folder geometry");
  await pointerDrag(page, page.locator(".recent-row", { hasText: LATER }), {
    x: bundle.x + bundle.width / 2,
    y: bundle.y + bundle.height * 0.9,
  });
  // top-level rows only: none inside a folder's children
  const rootNotes = async () =>
    (await page.locator(".main-tree .main-row:not(.main-branch-children .main-row)").allInnerTexts())
      .map((text) => text.trim())
      .filter((text) => text.startsWith(NOTE) || text.startsWith(LATER));
  await fileIntoBundle();
  const again = await row.boundingBox();
  if (!again) throw new Error("no row geometry");
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height + 12, { steps: 6 });
  const strip2 = await strip.boundingBox();
  if (!strip2) throw new Error("no drop-space geometry");
  await page.mouse.move(strip2.x + strip2.width / 2, strip2.y + strip2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(rootNotes).toEqual([NOTE, LATER]);

  // and by the menu
  await fileIntoBundle();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from folder" }).click();
  await expect(page.locator(".main-branch-children .main-row", { hasText: NOTE })).toHaveCount(0);
  await expect(row).toBeVisible();
  // a top-level note has nothing to be removed from
  await row.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Add to folder" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Remove from folder" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // a refused folder name keeps the field open, and clicking away still closes it
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename folder…" }).click();
  const rename = page.locator(".main-tree").getByRole("textbox", { name: "Rename Main folder" });
  await rename.fill("a/b");
  await rename.press("Enter");
  await expect(rename).toBeVisible();
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await expect(rename).toHaveCount(0);
  await expect(folder).toBeVisible();
});
