// Regression-layer handoff item 1 (docs/architecture/code-audit.md): re-test
// the CMP-1 off-by-one explicitly. `src/state/panes.test.ts` locks moveTab's
// visual-slot math at the unit level ("A","p1",3 on [A,B,C] -> [B,C,A]" — the
// preview line past the LAST tab lands the dragged tab at the very end, not
// second-to-last). This spec drives the real pointer gesture end to end
// (src/lib/tabDrag.ts's stripIndex hit-test -> moveTab) so a regression in the
// wiring between the two — not just the reducer — fails CI.

import { expect, test } from "@playwright/test";

import { centerOf, edgePoint, gotoApp, pointerDrag } from "./support";

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

test("a Main note dragged onto a pane opens there; onto a pane edge it carves a split", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  for (const title of ["Groceries", "Pricing decision"]) {
    await pointerDrag(
      page,
      page.locator(".recent-row", { hasText: title }).first(),
      await centerOf(mainRoot),
    );
  }
  // back to the panes so a pane body is on screen
  await page.locator(".main-row", { hasText: "Groceries" }).click();
  const panes = page.locator("section:has(> [data-pane-body])");
  await expect(panes).toHaveCount(1);
  const tabs = page.getByRole("tab");
  const before = await tabs.count();

  // center of the pane → a new tab in it
  await pointerDrag(
    page,
    page.locator(".main-row", { hasText: "Pricing decision" }),
    await centerOf(panes.first().locator("[data-pane-body]")),
  );
  await expect(tabs).toHaveCount(before + 1);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Pricing decision");

  // right edge → a second pane holding the note
  await pointerDrag(
    page,
    page.locator(".main-row", { hasText: "Groceries" }),
    await edgePoint(panes.first().locator("[data-pane-body]"), "right"),
  );
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(1).getByRole("tab", { selected: true })).toContainText("Groceries");
});
