// ⌘Z and ⇧⌘Z in a sheet (the owner, 2026-10-09: "we need the hotkeys for undo
// and redo to work, the standard hotkeys"). On the Mac the Edit menu owns ⌘Z
// before the web view sees a keydown, and WebKit turns its undo:/redo: into
// beforeinput (historyUndo/historyRedo) on the focused element — Univer's
// hidden cell input, which has no history of its own. The DOCX adapter
// answers the same events (documents/engine/keys.ts); this proves a sheet does.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the native Undo and Redo menu commands undo and redo a sheet edit", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const ExcelJS = (await import("/node_modules/.vite/deps/exceljs.js" as string)).default;
    const { workbookToModel } = await import("/src/sheets/engine/bridge.ts" as string);
    const { mountSheet } = await import("/src/sheets/engine/univer.tsx" as string);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Budget").addRow(["Rent", 1800]);
    const host = document.createElement("div");
    host.className = "sheet-undo-probe";
    host.style.cssText =
      "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:white";
    document.body.append(host);
    (window as unknown as { sheet: unknown }).sheet = mountSheet(host, {
      model: workbookToModel(wb, "undo.xlsx"),
      darkMode: false,
      themeMode: "themed",
    });
  });
  // what A1 holds in the workbook the sheet would save
  const a1 = () =>
    page.evaluate(() => {
      const handle = (window as unknown as { sheet: { save(): { sheets: Record<string, unknown> } } }).sheet;
      const sheet = Object.values(handle.save().sheets)[0] as {
        cellData?: Record<number, Record<number, { v?: unknown }>>;
      };
      return sheet.cellData?.[0]?.[0]?.v ?? null;
    });
  // macOS Edit → Undo / Redo, as WebKit delivers it to the focused element
  const menu = (inputType: "historyUndo" | "historyRedo") =>
    page.evaluate((type) => {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new InputEvent("beforeinput", { inputType: type, bubbles: true, cancelable: true }),
      );
    }, inputType);

  await expect(page.locator(".sheet-undo-probe canvas").first()).toBeVisible();
  await expect.poll(a1).toBe("Rent");

  // a fresh sheet opens on A1 with its cell input focused: type over it
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-undo-probe")))
    .toBe(true);
  await page.keyboard.type("Lease");
  await page.keyboard.press("Enter");
  await expect.poll(a1).toBe("Lease");

  await menu("historyUndo");
  await expect.poll(a1).toBe("Rent");
  await menu("historyRedo");
  await expect.poll(a1).toBe("Lease");
});

// Since the Edit menu's Undo/Redo carry no keys, ⌘Z / ⇧⌘Z reach the sheet as
// key presses. Sent as events here — the specs never press ⌘ chords on the
// keyboard (Linux CI has no Meta key) — they still reach the same listeners.
test("⌘Z undoes and ⇧⌘Z redoes a sheet edit, and ⇧⌘Z while typing in a cell leaves the workbook alone", async ({
  page,
}) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const ExcelJS = (await import("/node_modules/.vite/deps/exceljs.js" as string)).default;
    const { workbookToModel } = await import("/src/sheets/engine/bridge.ts" as string);
    const { mountSheet } = await import("/src/sheets/engine/univer.tsx" as string);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Budget").addRow(["Rent", 1800]);
    const host = document.createElement("div");
    host.className = "sheet-keys-probe";
    host.style.cssText =
      "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:white";
    document.body.append(host);
    (window as unknown as { sheet: unknown }).sheet = mountSheet(host, {
      model: workbookToModel(wb, "keys.xlsx"),
      darkMode: false,
      themeMode: "themed",
    });
  });
  const a1 = () =>
    page.evaluate(() => {
      const handle = (window as unknown as { sheet: { save(): { sheets: Record<string, unknown> } } }).sheet;
      const sheet = Object.values(handle.save().sheets)[0] as {
        cellData?: Record<number, Record<number, { v?: unknown }>>;
      };
      return sheet.cellData?.[0]?.[0]?.v ?? null;
    });
  // the same key event Edit → Undo / Redo replays (keys/editHistoryActions.ts)
  const chord = (shift: boolean) =>
    page.evaluate(async (redo) => {
      const { historyKeyEvent } = await import("/src/keys/editHistoryActions.ts" as string);
      (document.activeElement ?? document.body).dispatchEvent(historyKeyEvent(redo));
    }, shift);
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-keys-probe")))
    .toBe(true);
  await expect.poll(a1).toBe("Rent");

  await page.keyboard.type("Lease");
  await page.keyboard.press("Enter");
  await expect.poll(a1).toBe("Lease");
  await page.keyboard.press("ArrowUp"); // back on A1, committed
  await chord(false);
  await expect.poll(a1).toBe("Rent");
  await chord(true);
  await expect.poll(a1).toBe("Lease");

  // undo again, then start typing in A1 without Enter: ⇧⌘Z must not redo the
  // workbook behind the open cell (that would put "Lease" back into A1)
  await chord(false);
  await expect.poll(a1).toBe("Rent");
  await page.keyboard.type("dra");
  await chord(true);
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect.poll(a1).toBe("Rent");
});
