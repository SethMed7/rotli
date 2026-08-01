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

test("⌘-click gathers Main rows and one drag moves them all into a folder", async ({ page }) => {
  await gotoApp(page);

  // stock Main with three notes + a folder
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  for (const title of ["Launch checklist", "Groceries", "Quokka world"]) {
    await pointerDrag(
      page,
      page.locator(".recent-row", { hasText: title }).first(),
      await centerOf(mainRoot),
    );
    await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  }
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Bundle");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Bundle" });
  await expect(folder).toBeVisible();

  // ⌘-click two rows → both gather; drag one → both land in the folder
  await page.locator(".main-row", { hasText: "Groceries" }).click({ modifiers: ["Meta"] });
  await page.locator(".main-row", { hasText: "Quokka world" }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".main-row.msel")).toHaveCount(2);
  await pointerDrag(page, page.locator(".main-row", { hasText: "Groceries" }), await centerOf(folder));
  const inFolder = page.locator('[data-main-id="main:Bundle"] ~ * .main-row, [data-main-id^="main:Bundle"]');
  await expect(page.locator(".main-row.msel")).toHaveCount(0); // selection cleared after the move
  // both notes now render under the folder (indented rows follow it)
  await expect(page.locator(".main-tree", { hasText: "Groceries" })).toBeVisible();
  await expect(page.locator(".main-tree", { hasText: "Quokka world" })).toBeVisible();
  void inFolder;
});
