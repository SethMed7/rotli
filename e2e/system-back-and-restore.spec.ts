// Two of the owner's 2026-09-16 items, proven in the browser twin: the System
// browsers offer a way back at their root, and a note sent to Trash keeps its
// Main slot so Restore (from the note's own header) puts it back in place.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("Trash, Library, Assets, and Archive have Back to notes at their root", async ({ page }) => {
  await gotoApp(page);
  for (const root of ["Trash", "Library", "Assets", "Archive"]) {
    await page.locator(".frow", { hasText: root }).first().click();
    await expect(page.locator(".system-browser .board-title")).toHaveText(root);
    await page.locator(".system-browser").getByRole("button", { name: "Back to notes" }).click();
    await expect(page.locator(".system-browser")).toHaveCount(0);
    await expect(page.getByRole("tablist")).toBeVisible();
  }
});

test("a trashed note keeps its Main slot and Restore from its header returns it there", async ({ page }) => {
  await gotoApp(page);
  const title = "Q3 priorities — Northstar";
  // the twin's Main starts empty: file the note there first (All notes → Main root)
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: title });
  await pointerDrag(page, source, await centerOf(page.locator('[data-main-id="main:"]')));
  const row = page.locator(".main-tree [data-main-id]", { hasText: title });
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toHaveCount(0);

  // open it from Trash: the header offers Restore
  await page.locator(".frow", { hasText: "Trash" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Trash");
  await page.locator(".system-browser .fdr-tile", { hasText: title }).dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText(title);
  await page.getByRole("button", { name: "Restore this note" }).click();

  // back in its Main folder, and the chip is gone
  await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore this note" })).toHaveCount(0);
});
