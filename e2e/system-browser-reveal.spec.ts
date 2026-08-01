// The Library browser's Finder truths (paper-cut sweep + Finder rework
// 2026-07-27): an EMPTY folder is still a real folder and renders as a tile,
// and "Show in Library" lands IN the note's exact folder — the browser
// navigates there, the row carries the one active state — never just the root.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("the Library browser renders empty folders as real tiles", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".frow", { hasText: "Library" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Library");

  // wiki/People holds no notes — it must still render, honestly empty
  const empty = page.locator(".system-browser .fdr-tile", { hasText: "People" });
  await expect(empty).toBeVisible();
  await expect(empty.locator(".fdr-tile-sub")).toHaveText("0 items");

  // searching flattens to results — match-less folders leave the view
  await page.locator(".system-browser .allnotes-search input").fill("Launch");
  await expect(page.locator(".system-browser .fdr-tile", { hasText: "People" })).toHaveCount(0);
});

test("Show in Library lands IN the note's exact folder with the row marked", async ({ page }) => {
  await gotoApp(page);

  // find the filed note in All notes and ask for its Library home
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Launch checklist" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in Library" }).click();

  // the browser navigated INTO wiki/Projects: the breadcrumb ends on the
  // folder, the Library crumb climbs back, and the note carries the active state
  await expect(page.locator(".system-browser .board-title")).toHaveText("Projects");
  await expect(page.locator(".system-browser .fdr-crumb", { hasText: "Library" })).toBeVisible();
  await expect(page.locator(".system-browser .fdr-tile.sel", { hasText: "Launch checklist" })).toBeVisible();
});
