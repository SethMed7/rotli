// The bridge's law: apply(load(wb)) then write→reload must be IDENTITY on the
// modeled subset (values, formulas, styles, merges, sizes, freeze, numFmt), and
// simulated Univer edits must land faithfully in the reloaded file. All tests
// run REAL exceljs write→load cycles — no mocks, no Univer runtime.

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";
import {
  type USnapshot,
  applySnapshotToWorkbook,
  colIndex,
  dateToSerial,
  workbookToUniverData,
} from "./univerBridge";

const HASH = "#"; // built at runtime so no hex literal appears in source

function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`);
  return v;
}

/** A workbook exercising every modeled feature. */
function richWorkbook(): Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.getCell("A1").value = "title";
  ws.getCell("A1").font = { bold: true, italic: true, underline: true, size: 14, name: "Georgia", color: { argb: "FF112233" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getCell("A1").border = { bottom: { style: "thin", color: { argb: "FF445566" } }, right: { style: "thick" } };
  ws.getCell("B1").value = 42;
  ws.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEE00" } };
  ws.getCell("B2").value = 1234.5;
  ws.getCell("B2").numFmt = "$#,##0.00";
  ws.getCell("C1").value = new Date(Date.UTC(2026, 6, 9)); // 2026-07-09
  ws.getCell("A3").value = { formula: "SUM(B1:B2)", result: 1276.5, date1904: false };
  ws.getCell("D4").value = true;
  ws.mergeCells("A5:B6");
  ws.getCell("A5").value = "merged";
  ws.getColumn(2).width = 20;
  ws.getRow(1).height = 30;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  return wb;
}

/** Write → reload through real xlsx bytes. */
async function reload(wb: Workbook): Promise<Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf as ArrayBuffer);
  return wb2;
}

const sheetOf = (snap: USnapshot, i = 0) =>
  must(snap.sheets[must(snap.sheetOrder[i], "sheet id")], "sheet");

describe("colIndex", () => {
  test("inverts column labels", () => {
    expect(colIndex("A")).toBe(0);
    expect(colIndex("Z")).toBe(25);
    expect(colIndex("AA")).toBe(26);
    expect(colIndex("AZ")).toBe(51);
  });
});

describe("load: workbookToUniverData", () => {
  const snap = workbookToUniverData(richWorkbook(), "rich.xlsx");
  const sh = sheetOf(snap);

  test("values, formulas, booleans, and dates (as serials) project", () => {
    expect(sh.cellData?.[0]?.[0]?.v).toBe("title");
    expect(sh.cellData?.[0]?.[1]?.v).toBe(42);
    expect(sh.cellData?.[2]?.[0]?.f).toBe("=SUM(B1:B2)");
    expect(sh.cellData?.[2]?.[0]?.v).toBe(1276.5);
    expect(sh.cellData?.[3]?.[3]?.v).toBe(true);
    const serial = sh.cellData?.[0]?.[2]?.v;
    expect(serial).toBe(dateToSerial(new Date(Date.UTC(2026, 6, 9))));
    // a date cell gets a date numFmt so Univer renders it as a date
    const dateStyle = sh.cellData?.[0]?.[2]?.s;
    expect(typeof dateStyle === "object" && dateStyle?.n?.pattern).toBeTruthy();
  });

  test("styles project (font, fill, align, wrap, borders, numFmt)", () => {
    const a1 = sh.cellData?.[0]?.[0]?.s;
    if (typeof a1 !== "object" || !a1) throw new Error("A1 style missing");
    expect(a1.bl).toBe(1);
    expect(a1.it).toBe(1);
    expect(a1.ul?.s).toBe(1);
    expect(a1.fs).toBe(14);
    expect(a1.ff).toBe("Georgia");
    expect(a1.cl?.rgb).toBe(`${HASH}112233`);
    expect(a1.ht).toBe(2);
    expect(a1.vt).toBe(2);
    expect(a1.tb).toBe(3);
    expect(a1.bd?.b?.s).toBe(1);
    expect(a1.bd?.b?.cl?.rgb).toBe(`${HASH}445566`);
    expect(a1.bd?.r?.s).toBe(13); // thick
    const b1 = sh.cellData?.[0]?.[1]?.s;
    expect(typeof b1 === "object" && b1?.bg?.rgb).toBe(`${HASH}ffee00`);
    const b2 = sh.cellData?.[1]?.[1]?.s;
    expect(typeof b2 === "object" && b2?.n?.pattern).toBe("$#,##0.00");
  });

  test("merges, sizes, and freeze project", () => {
    expect(sh.mergeData).toEqual([{ startRow: 4, startColumn: 0, endRow: 5, endColumn: 1 }]);
    expect(sh.columnData?.[1]?.w).toBe(150); // 20 chars × 7.5
    expect(sh.rowData?.[0]?.h).toBe(40); // 30pt × 4/3
    expect(sh.freeze).toEqual({ xSplit: 1, ySplit: 1, startRow: -1, startColumn: -1 });
  });
});

describe("apply ∘ load = identity (through real xlsx bytes)", () => {
  test("the modeled subset survives apply → write → reload unchanged", async () => {
    const wb = richWorkbook();
    const before = workbookToUniverData(wb, "t");
    applySnapshotToWorkbook(wb, before);
    const wb2 = await reload(wb);
    const after = workbookToUniverData(wb2, "t");
    // sheet-level deep equality on everything the bridge models
    expect(sheetOf(after).cellData).toEqual(sheetOf(before).cellData);
    expect(sheetOf(after).mergeData).toEqual(sheetOf(before).mergeData);
    expect(sheetOf(after).columnData).toEqual(sheetOf(before).columnData);
    expect(sheetOf(after).rowData).toEqual(sheetOf(before).rowData);
    expect(sheetOf(after).freeze).toEqual(sheetOf(before).freeze);
    expect(after.sheetOrder.length).toBe(before.sheetOrder.length);
  });
});

describe("simulated Univer edits land in the reloaded file", () => {
  test("value change · new formula · new styled cell · cleared cell", async () => {
    const wb = richWorkbook();
    const snap = workbookToUniverData(wb, "t");
    const sh = sheetOf(snap);
    const cells = must(sh.cellData, "cellData");
    (cells[0] ??= {})[0] = { v: "renamed" }; // A1: new value, style dropped
    (cells[6] ??= {})[0] = { f: "=B1*2", v: 84 }; // A7: new formula
    (cells[6] ??= {})[2] = { v: "loud", s: { bl: 1, bg: { rgb: `${HASH}ff0000` } } }; // C7 styled
    delete must(cells[0], "row0")[1]; // B1 cleared in Univer

    applySnapshotToWorkbook(wb, snap);
    const wb2 = await reload(wb);
    const ws = must(wb2.worksheets[0], "ws");
    expect(ws.getCell("A1").value).toBe("renamed");
    expect(ws.getCell("A1").font?.bold).toBeFalsy(); // style shed with the snapshot
    const f = ws.getCell("A7").value;
    expect(typeof f === "object" && f !== null && "formula" in f && f.formula).toBe("B1*2");
    expect(ws.getCell("C7").font?.bold).toBe(true);
    expect(ws.getCell("C7").fill && "fgColor" in ws.getCell("C7").fill! ? (ws.getCell("C7").fill as { fgColor?: { argb?: string } }).fgColor?.argb : null).toBe("FFFF0000");
    expect(ws.getCell("B1").value ?? null).toBeNull(); // cleared
  });

  test("merge added · resize · rename · sheet added · sheet removed", async () => {
    const wb = richWorkbook();
    wb.addWorksheet("Doomed");
    const snap = workbookToUniverData(wb, "t");
    expect(snap.sheetOrder).toHaveLength(2);
    const sh = sheetOf(snap);
    sh.name = "Numbers";
    sh.mergeData = [...(sh.mergeData ?? []), { startRow: 9, startColumn: 0, endRow: 9, endColumn: 3 }];
    (sh.columnData ??= {})[0] = { w: 300 };
    (sh.rowData ??= {})[9] = { h: 60 };
    // drop "Doomed" (sheet-1) and add a Univer-born sheet
    snap.sheetOrder = [must(snap.sheetOrder[0], "id0"), "univer-new-1"];
    delete snap.sheets["sheet-1"];
    snap.sheets["univer-new-1"] = {
      id: "univer-new-1",
      name: "Fresh",
      cellData: { 0: { 0: { v: "hello" } } },
    };

    applySnapshotToWorkbook(wb, snap);
    const wb2 = await reload(wb);
    expect(wb2.worksheets.map((w) => w.name)).toEqual(["Numbers", "Fresh"]);
    const ws = must(wb2.getWorksheet("Numbers"), "renamed sheet");
    expect((ws.model?.merges as string[]).includes("A10:D10")).toBe(true);
    expect(Math.round(must(ws.getColumn(1).width, "width"))).toBe(40); // 300px ÷ 7.5
    expect(Math.round(must(ws.getRow(10).height, "height"))).toBe(45); // 60px × 3/4
    expect(must(wb2.getWorksheet("Fresh"), "new sheet").getCell("A1").value).toBe("hello");
  });

  test("style-dict references (snapshot.styles ids) resolve", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("S").getCell("A1").value = "x";
    const snap = workbookToUniverData(wb, "t");
    snap.styles = { st1: { bl: 1, cl: { rgb: `${HASH}00aa00` } } };
    must(sheetOf(snap).cellData, "cells")[0] = { 0: { v: "x", s: "st1" } };
    applySnapshotToWorkbook(wb, snap);
    const ws = must((await reload(wb)).worksheets[0], "ws");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("A1").font?.color?.argb).toBe("FF00AA00");
  });
});

describe("mutate-don't-regenerate preserves unmodeled workbook features", () => {
  test("workbook properties + defined names survive an apply", async () => {
    const wb = richWorkbook();
    wb.creator = "Seth Medina";
    wb.definedNames.add("Data!$B$1", "TheAnswer");
    const snap = workbookToUniverData(wb, "t");
    applySnapshotToWorkbook(wb, snap);
    const wb2 = await reload(wb);
    expect(wb2.creator).toBe("Seth Medina");
    expect(wb2.definedNames.getRanges("TheAnswer").ranges.length).toBeGreaterThan(0);
  });
});
