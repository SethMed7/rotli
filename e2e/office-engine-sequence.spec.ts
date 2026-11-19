// Document and workbook engines must coexist without leaking facade services
// across independent Univer instances, including after either engine is disposed.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

async function mountSheet(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const ExcelJS = (await import("/node_modules/.vite/deps/exceljs.js" as string)).default;
    const { workbookToModel } = await import("/src/sheets/engine/bridge.ts" as string);
    const { mountSheet: mount } = await import("/src/sheets/engine/univer.tsx" as string);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Budget");
    ws.addRow(["Item", 12.5]);
    ws.addRow(["Total", { formula: "SUM(B1:B1)" }]);
    const host = document.createElement("div");
    host.id = "sequence-sheet";
    host.style.cssText =
      "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:white";
    document.body.append(host);
    const handle = mount(host, {
      model: workbookToModel(wb, "sequence.xlsx"),
      darkMode: false,
      themeMode: "themed",
    });
    const w = window as unknown as { sequenceSheet: unknown; sheetEdits: number };
    w.sequenceSheet = handle;
    w.sheetEdits = 0;
    handle.onDirty(() => {
      w.sheetEdits += 1;
    });
  });
  await expect(page.locator("#sequence-sheet canvas").first()).toBeVisible();
}

async function disposeSheet(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { sequenceSheet: { dispose(): void } }).sequenceSheet.dispose();
    document.getElementById("sequence-sheet")?.remove();
  });
}

test("a document opened after a workbook edits and saves, and a later workbook still edits", async ({
  page,
}) => {
  // three Univer mounts from a cold dev server: CI's first engine import alone
  // took 11.6 s (2026-10-12), past the default 30 s once all three ran
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await gotoApp(page);

  await mountSheet(page);
  await page.waitForTimeout(1000);
  await disposeSheet(page);

  await page.evaluate(async () => {
    const { mountDocumentEditor } = await import("/src/documents/engine/univer.ts" as string);
    const host = document.createElement("div");
    host.id = "sequence-doc";
    host.style.cssText = "position: fixed; inset: 0; z-index: 9999; background: white";
    document.body.append(host);
    const handle = mountDocumentEditor(host, {
      id: "sequence.docx",
      title: "Sequence",
      content: [{ kind: "paragraph", paragraph: { runs: [{ text: "Plain" }] } }],
    });
    (window as unknown as { sequenceDoc: unknown }).sequenceDoc = handle;
    await handle.ready;
  });
  const canvas = page.locator("#sequence-doc canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("document canvas has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await page.keyboard.press("End");
  await page.keyboard.type(" after a workbook");
  const text = await page.evaluate(() => {
    const handle = (window as unknown as { sequenceDoc: { save(): unknown; dispose(): void } }).sequenceDoc;
    const saved = handle.save() as { content: { paragraph?: { runs: { text: string }[] } }[] };
    handle.dispose();
    document.getElementById("sequence-doc")?.remove();
    return saved.content
      .flatMap((item) => item.paragraph?.runs ?? [])
      .map((run) => run.text)
      .join("");
  });
  expect(text).toContain("after a workbook");

  // the workbook engine is unharmed: a new one mounts and takes an edit
  await mountSheet(page);
  await page.waitForTimeout(1500);
  const sheet = page.locator("#sequence-sheet canvas").first();
  const sheetBox = await sheet.boundingBox();
  if (!sheetBox) throw new Error("no sheet canvas");
  await page.mouse.click(sheetBox.x + 120, sheetBox.y + 40);
  await page.keyboard.type("42");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { sheetEdits: number }).sheetEdits))
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
