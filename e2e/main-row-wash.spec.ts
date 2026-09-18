// A Main row's hover/open wash starts just left of its icon, not at the
// sidebar's edge (the owner, 2026-09-18), so nesting stays readable. The row
// itself keeps the full-width hit area.
import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test("the open note's wash starts beside its icon, deeper inside a folder", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  for (const title of ["Launch checklist", "Groceries"]) {
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
  await page.locator(".main-row", { hasText: "Groceries" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to folder", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bundle", exact: true }).click();

  const wash = (title: string) =>
    page.locator(".main-row", { hasText: title }).evaluate((row) => {
      const before = getComputedStyle(row, "::before");
      const icon = row.querySelector("svg")!.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return { left: parseFloat(before.left), iconLeft: icon.left - box.left, rowLeft: box.left };
    });
  const top = await wash("Launch checklist");
  const nested = await wash("Groceries");
  // a tad left of the icon, never the row's own edge
  for (const row of [top, nested]) {
    expect(row.left).toBeGreaterThan(0);
    expect(row.iconLeft - row.left).toBeGreaterThan(4);
    expect(row.iconLeft - row.left).toBeLessThan(14);
  }
  expect(nested.left).toBeGreaterThan(top.left + 10);
  // the row still spans the sidebar: the whole line is clickable
  expect(nested.rowLeft).toBe(top.rowLeft);
});
