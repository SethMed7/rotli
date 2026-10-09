// ⌘C on a sheet column (the owner, 2026-10-09: "cmd+c is not working in
// sheets when copying a column"). On the Mac the Edit menu takes ⌘C before
// the web view sees a keydown, and WebKit fires `copy` at the focused element
// — Univer's hidden cell input, holding at most one cell's text. Univer copies
// only from its own ⌘C keydown, so a column copied nothing. The sheet adapter
// now answers the menu's copy with the selection's content. Mounted through
// the engine seam (the browser twin has no file bytes).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the native Copy menu command copies a whole selected column", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const ExcelJS = (await import("/node_modules/.vite/deps/exceljs.js" as string)).default;
    const { workbookToModel } = await import("/src/sheets/engine/bridge.ts" as string);
    const { mountSheet } = await import("/src/sheets/engine/univer.tsx" as string);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Budget");
    for (const row of [
      ["Month", "Rent"],
      ["Jan", 1800],
      ["Feb", 1850],
    ])
      ws.addRow(row);
    const host = document.createElement("div");
    host.className = "sheet-copy-probe";
    host.style.cssText =
      "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:white";
    document.body.append(host);
    mountSheet(host, { model: workbookToModel(wb, "copy.xlsx"), darkMode: false, themeMode: "themed" });
  });
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-copy-probe")))
    .toBe(true);

  // select column B by its header: the header row sits just above row 1, and
  // the A1 cell is the one Univer selects on open
  const header = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".sheet-copy-probe canvas")].map((c) =>
      c.getBoundingClientRect(),
    );
    const grid = cells.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return grid ? { x: grid.x, y: grid.y } : null;
  });
  if (!header) throw new Error("no grid canvas");
  // the grid canvas includes the row/column headers: B's header is one
  // column (88px) right of A's, A starting after the 46px row header
  await page.mouse.click(header.x + 46 + 88 + 44, header.y + 10);
  await page.waitForTimeout(200);

  // macOS Edit → Copy, as WebKit delivers it to the focused element
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    const target = document.activeElement ?? document.body;
    const event = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return {
      plain: data.getData("text/plain"),
      html: data.getData("text/html").length,
      handled: event.defaultPrevented,
    };
  });
  expect(copied.handled).toBe(true);
  expect(copied.plain.split(/\r?\n/).filter(Boolean)).toEqual(["Rent", "1800", "1850"]);
  expect(copied.html).toBeGreaterThan(0);
});
