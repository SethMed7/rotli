// The pane-focus landing light (Seth, 2026-07-30): when focus moves between
// panes in a split, the arriving pane briefly wears an accent outline
// (.focus-flash) and it fades away — a quick "you are here", not a permanent
// decoration.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test.use({ viewport: { width: 1600, height: 900 } });

test("focusing another pane flashes it briefly, then the light fades", async ({ page }) => {
  await gotoApp(page);

  // carve a second pane through a real control: the note row's Open to the right
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Launch checklist" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the right" }).click();
  await expect(page.locator(".pane")).toHaveCount(2);

  // the newly carved pane arrived focused → it wears the landing light
  await expect(page.locator(".pane.focus-flash")).toHaveCount(1);
  // …and the light fades on its own
  await expect(page.locator(".pane.focus-flash")).toHaveCount(0, { timeout: 2_000 });

  // clicking back into the first pane flashes THAT pane
  const first = page.locator(".pane").first();
  await first.locator(".pane-body").click();
  await expect(first).toHaveClass(/focus-flash/);
  await expect(page.locator(".pane.focus-flash")).toHaveCount(0, { timeout: 2_000 });
});
