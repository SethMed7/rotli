// Talk to the Librarian (`/librarian`, 2026-09-28): the slash command swaps the
// format bar for the Librarian bar in this pane, and Escape puts the format
// bar back. The model call and the metadata writes are Mac-only (proved by
// src/services/librarianBar.test.ts and a native check); outside the Mac app
// the bar says so in one sentence and offers nothing else.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("/librarian swaps the format bar for the Librarian bar, and Escape brings it back", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".pane.focused .cm-content");
  await editor.click();
  await page.keyboard.insertText("# Maya Chen\n\nMet Maya at the design meetup.\n\n");
  const formatBar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(formatBar).toBeVisible();

  await page.keyboard.type("/librarian");
  const menu = page.getByRole("menu", { name: "Insert block" });
  await menu.getByRole("menuitem", { name: /Talk to the Librarian/ }).click();

  const bar = page.getByRole("region", { name: "Librarian" });
  await expect(bar).toBeVisible();
  await expect(formatBar).toHaveCount(0);
  // the slash text itself is gone from the note
  await expect(editor).not.toContainText("/librarian");
  // this build isn't the Mac app: one plain sentence, no request box
  await expect(bar.getByRole("status")).toHaveText("The Librarian works in the Mac app.");
  await expect(bar.getByRole("textbox", { name: "Ask the Librarian" })).toHaveCount(0);

  // the live highlight chip follows the note's selection
  await page.locator(".cm-line", { hasText: "design meetup" }).dblclick({ position: { x: 5, y: 5 } });
  await expect(bar.locator(".libbar-chip")).not.toHaveText("Highlight a passage to mark it");

  await bar.getByRole("button", { name: "Close the Librarian" }).focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(formatBar).toBeVisible();
});
