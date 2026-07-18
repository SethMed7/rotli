// Regression-layer handoff item 4 (docs/architecture/code-audit.md): Main
// add-drag. Covers the SHARED src/lib/mainAddDrag.ts module — the drag source
// here is a note-list row (src/components/noteListRow.tsx, "the All-notes
// list rows and (via tabDrag) editor tabs" per that file's own header comment)
// rather than the sidebar's own local implementation (see
// sidebar-cross-section-drag.spec.ts), so this exercises a genuinely different
// wiring of the same drop contract.

import { expect, test } from "@playwright/test";
import { centerOf, gotoApp, pointerDrag } from "./support";

test("dragging an All-notes row into Main adds it there", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const row = page.locator(".recent-row", { hasText: "Q3 priorities — Myela" });
  await expect(row).toBeVisible();

  const mainRoot = page.locator('[data-main-id="main:"]');
  await expect(mainRoot).toContainText("arranged your way");

  await pointerDrag(page, row, await centerOf(mainRoot));

  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Q3 priorities — Myela" })).toBeVisible();
});
