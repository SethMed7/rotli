// 2026-09-26 (Round Three): a note moved to Trash kept its tab open, because a
// note's id survives the move and the tab kept resolving. Trashing now closes
// the note's tabs, the way trashing a file already closed its tabs.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

const TITLE = "Q3 priorities — Northstar";

test("moving an open note to Trash from the sidebar closes its tab", async ({ page }) => {
  await gotoApp(page);
  // the twin's Main starts empty: file the note there first (All notes → Main root)
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: TITLE });
  await pointerDrag(page, source, await centerOf(page.locator('[data-main-id="main:"]')));
  const row = page.locator(".main-tree [data-main-id]", { hasText: TITLE });
  await row.click();
  const noteTab = page.getByRole("tab", { name: new RegExp(TITLE) });
  await expect(noteTab).toBeVisible();

  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(row).toHaveCount(0);
  await expect(noteTab).toHaveCount(0);
});

test("the palette's Move note to Trash closes the note's tab", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: TITLE }).click();
  const noteTab = page.getByRole("tab", { name: new RegExp(TITLE) });
  await expect(noteTab).toBeVisible();

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Move note to Trash");
  await page.locator(".prow", { hasText: "Move note to Trash" }).first().click();
  await expect(noteTab).toHaveCount(0);
});
