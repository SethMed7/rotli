// The Library browser's Finder truths (paper-cut sweep 2026-07-27): an EMPTY
// folder is still a real folder and renders with a zero count, and "Show in
// Library" lands on the note's exact folder — group expanded, row marked with
// the one active state, scrolled into view — never just the browser root.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("the Library browser renders empty folders with a zero count", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".frow", { hasText: "Library" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Library");

  // wiki/People holds no notes — it must still render, honestly empty
  const empty = page.locator(".system-browser .sysb-folder", { hasText: "People" });
  await expect(empty).toBeVisible();
  await expect(empty.locator(".count")).toHaveText("0");

  // searching removes match-less folders entirely (the existing rule)
  await page.locator(".system-browser .allnotes-search input").fill("Launch");
  await expect(page.locator(".system-browser .sysb-folder", { hasText: "People" })).toHaveCount(0);
});

test("Show in Library lands on the note's exact folder with the row marked", async ({ page }) => {
  await gotoApp(page);

  // find the filed note in All notes and ask for its Library home
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Launch checklist" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in Library" }).click();

  // the Library browser opens on the note's folder, not the root: the Projects
  // group is expanded and the exact row carries the active state
  await expect(page.locator(".system-browser .board-title")).toHaveText("Library");
  const row = page.locator(".system-browser .recent-row.sel", { hasText: "Launch checklist" });
  await expect(row).toBeVisible();
});
