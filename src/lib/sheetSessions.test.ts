// The dirty-sheet flush (#4, audit 2026-07): parked sessions are written
// through the explicit-save shape when the window hides; a failed write keeps
// the session parked; an edit landing mid-flush is never clobbered off the map.

import { describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";
import { bytesFromB64 } from "./sheetEdit";
import { type SheetSession, dirtySessions, flushDirtySheets, serializeSession } from "./sheetSessions";

const cell = (v: string) => ({ v, style: null, formula: false });

function csvSession(rows: string[][]): SheetSession {
  return { wb: null, grids: [{ name: "sheet", rows: rows.map((r) => r.map(cell)) }] };
}

const textOf = (b64: string) => new TextDecoder().decode(bytesFromB64(b64));

describe("serializeSession", () => {
  it("csv: values only, exactly what save() writes", async () => {
    const b64 = await serializeSession(csvSession([["a", "b"], ["c", ""]]));
    expect(textOf(b64)).toBe("a,b\nc,\n");
  });

  it("xlsx: the workbook is the payload", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("s1").getCell(1, 1).value = "hello";
    const b64 = await serializeSession({ wb, grids: [] });
    // round-trip through exceljs proves real workbook bytes were produced
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(bytesFromB64(b64).buffer as ArrayBuffer);
    expect(back.worksheets[0]?.getCell(1, 1).value).toBe("hello");
  });
});

describe("flushDirtySheets", () => {
  it("writes every parked session (bak=true) and clears the map", async () => {
    dirtySessions.clear();
    dirtySessions.set("Inbox/a.csv", csvSession([["1"]]));
    dirtySessions.set("Inbox/b.csv", csvSession([["2"]]));
    const written: [string, string, boolean][] = [];
    await flushDirtySheets(async (id, b64, bak) => {
      written.push([id, textOf(b64), bak ?? false]);
    });
    expect(written).toEqual([
      ["Inbox/a.csv", "1\n", true],
      ["Inbox/b.csv", "2\n", true],
    ]);
    expect(dirtySessions.size).toBe(0);
  });

  it("a failed write keeps that session parked for the next flush", async () => {
    dirtySessions.clear();
    dirtySessions.set("Inbox/ro.csv", csvSession([["x"]]));
    dirtySessions.set("Inbox/ok.csv", csvSession([["y"]]));
    await flushDirtySheets(async (id) => {
      if (id === "Inbox/ro.csv") throw new Error("read-only");
    });
    expect([...dirtySessions.keys()]).toEqual(["Inbox/ro.csv"]);
  });

  it("an edit re-parked while the write was in flight survives the clear", async () => {
    dirtySessions.clear();
    dirtySessions.set("Inbox/live.csv", csvSession([["old"]]));
    const newer = csvSession([["new"]]);
    await flushDirtySheets(async () => {
      // the user commits another edit mid-write — SheetEditor parks a FRESH object
      dirtySessions.set("Inbox/live.csv", newer);
    });
    // the stale session was written, but the newer one must still be parked
    expect(dirtySessions.get("Inbox/live.csv")).toBe(newer);
  });
});
