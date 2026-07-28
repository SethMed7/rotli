// Repro spec: ⌘K palette must support ↑/↓ selection and ⏎ open (r3 frame F's
// footer promise). Written against the browser twin's seeded demo corpus.

import { type Page, expect, test } from "@playwright/test";
import { gotoApp } from "./support";

/** The app registers ⌘K (Meta) only — a synthesized Ctrl+K does nothing on the
 * Linux runners (the 0.41.0 lesson). The titlebar search button dispatches the
 * same palette.toggle on every platform. */
async function openPalette(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
}

test("palette: arrows move the selection and Enter opens the row", async ({ page }) => {
  await gotoApp(page);
  await openPalette(page);
  const input = page.getByPlaceholder("Search notes, files, chats, actions…");
  await expect(input).toBeFocused();

  // empty query — Recent + Suggested rows exist
  const rows = page.locator(".prow");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  await expect(rows.nth(0)).toHaveClass(/sel/);
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveClass(/sel/);
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(0)).toHaveClass(/sel/);

  // typed query, then Enter opens the selected note as the active tab
  await input.fill("Welcome");
  await page.keyboard.press("ArrowDown");
  const selLabel = await page.locator(".prow.sel .plabel").innerText();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pal-scrim")).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText(selLabel.slice(0, 8));
});

test("palette: arrows keep working while the cursor rests over the list", async ({ page }) => {
  // the regression: ↑↓ scrolls the list, rows shift under the stationary
  // cursor, Chromium fires synthetic hover events, and a hover-driven
  // setIndex snaps the selection back — arrows read as dead
  await gotoApp(page);
  await openPalette(page);
  const input = page.getByPlaceholder("Search notes, files, chats, actions…");
  await input.fill("e"); // broad match — enough rows to overflow the 384px list
  const rows = page.locator(".prow");
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  // park the cursor over a row so hover votes are in play
  await rows.nth(1).hover();
  for (let i = 0; i < count - 1; i++) await page.keyboard.press("ArrowDown");
  await expect(rows.nth(count - 1)).toHaveClass(/sel/);
});
