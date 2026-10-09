// Clicking through a sheet's cells is not an edit (the owner, 2026-10-09:
// "clicking through cells shouldn't be marked as a change and flag the
// Saving… — I am just clicking, nothing changed"). Univer runs a selection as
// an OPERATION; only a MUTATION changes the workbook. Mounted through the
// engine seam, as the DOCX specs do: the browser twin has no file bytes.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("selecting cells leaves a sheet clean; typing a value marks it changed", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const ExcelJS = (await import("/node_modules/.vite/deps/exceljs.js" as string)).default;
    const { workbookToModel } = await import("/src/sheets/engine/bridge.ts" as string);
    const { mountSheet } = await import("/src/sheets/engine/univer.tsx" as string);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Budget");
    ws.addRow(["Month", "Rent"]);
    ws.addRow(["Jan", 1800]);
    const host = document.createElement("div");
    host.className = "sheet-dirty-probe";
    host.style.cssText =
      "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:white";
    document.body.append(host);
    const handle = mountSheet(host, {
      model: workbookToModel(wb, "probe.xlsx"),
      darkMode: false,
      themeMode: "themed",
    });
    const w = window as unknown as { sheetEdits: number };
    w.sheetEdits = 0;
    handle.onDirty(() => {
      w.sheetEdits += 1;
    });
  });
  const edits = () => page.evaluate(() => (window as unknown as { sheetEdits: number }).sheetEdits);
  const canvas = page.locator(".sheet-dirty-probe canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no sheet canvas");

  // click through several cells and move with the arrow keys
  for (const [dx, dy] of [
    [120, 40],
    [220, 40],
    [220, 70],
    [320, 100],
  ] as const) {
    await page.mouse.click(box.x + dx, box.y + dy);
  }
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  expect(await edits()).toBe(0);

  // typing a value is an edit
  await page.mouse.click(box.x + 320, box.y + 100);
  await page.keyboard.type("42");
  await page.keyboard.press("Enter");
  await expect.poll(edits).toBeGreaterThan(0);
});
