// Regression-layer handoff item 1 (docs/architecture/code-audit.md): re-test
// the CMP-1 off-by-one explicitly. `src/state/panes.test.ts` locks moveTab's
// visual-slot math at the unit level ("A","p1",3 on [A,B,C] -> [B,C,A]" — the
// preview line past the LAST tab lands the dragged tab at the very end, not
// second-to-last). This spec drives the real pointer gesture end to end
// (src/lib/tabDrag.ts's stripIndex hit-test -> moveTab) so a regression in the
// wiring between the two — not just the reducer — fails CI.

import { expect, test } from "@playwright/test";
import { edgePoint, gotoApp, pointerDrag } from "./support";

test("dragging a tab past the last tab lands it at the very end, not before it", async ({ page }) => {
  await gotoApp(page);

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveText(/rotli — notes first/);

  // open two more notes as new tabs (⌘-click, the app's forced-new-tab
  // gesture) so the pane has three distinguishable, orderable tabs
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Pricing decision" }).click({ modifiers: ["Meta"] });
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Groceries" }).click({ modifiers: ["Meta"] });

  await expect(tabs).toHaveCount(3);
  await expect(tabs).toHaveText([/rotli — notes first/, /Pricing decision/, /Groceries/]);

  // drag the first tab (Welcome) to just past the right edge of the last tab
  // (Groceries) — the CMP-1 regression used to insert it BEFORE the last tab
  const welcome = tabs.nth(0);
  const groceries = tabs.nth(2);
  const dropPoint = await edgePoint(groceries, "right");
  await pointerDrag(page, welcome, dropPoint);

  await expect(tabs).toHaveText([/Pricing decision/, /Groceries/, /rotli — notes first/]);
});
