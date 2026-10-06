import { describe, expect, test } from "bun:test";

import { fillFromCsvRows, loadXlsx, newWorkbook } from "./codec/xlsx";
import { buildSheetIdMap, workbookToModel } from "./engine/bridge";
import {
  type ParkedSession,
  deleteSetAside,
  flushDirtySheets,
  flushOnHide,
  getParked,
  getSetAside,
  parkedResume,
  saveSetAsideAsCopy,
  setAsideCopyBytes,
  setAsideCopyName,
  setAsideParked,
  setParked,
} from "./session";

/** A parked session a workbook can really be written from. */
function realPark(revision: string): ParkedSession {
  const wb = fillFromCsvRows(newWorkbook(), "S", [["a"], ["1"]]);
  const model = workbookToModel(wb, "storage/rotli/twice.xlsx");
  return { wb, model, idMap: buildSheetIdMap(wb, model), diskLen: 0, revision, mode: "xlsx" };
}

function park(revision: string, mode: ParkedSession["mode"] = "xlsx"): ParkedSession {
  return {
    wb: newWorkbook(),
    model: { id: "m", sheetOrder: [], sheets: {} } as unknown as ParkedSession["model"],
    idMap: new Map(),
    diskLen: 10,
    revision,
    mode,
  };
}

describe("parkedResume — what reopening does with edits parked earlier", () => {
  test("nothing parked opens the file fresh", () => {
    expect(parkedResume(undefined, "r1", "xlsx")).toBe("fresh");
  });

  test("an unchanged file resumes the parked edits", () => {
    expect(parkedResume(park("r1"), "r1", "xlsx")).toBe("resume");
  });

  test("a file changed on disk is a conflict, never a silent discard", () => {
    expect(parkedResume(park("r1"), "r2", "xlsx")).toBe("conflict");
  });

  test("a parked session in the other mode opens fresh", () => {
    expect(parkedResume(park("r1", "csv"), "r1", "xlsx")).toBe("fresh");
  });
});

describe("set-aside edits", () => {
  test("setting a parked session aside takes it out of the flush", async () => {
    const id = "storage/rotli/aside.xlsx";
    setParked(id, park("old"));
    setAsideParked(id);
    expect(getParked(id)).toBeUndefined();
    expect(getSetAside(id).map((s) => s.revision)).toEqual(["old"]);
    // the background flush must not retry a stale write it can only fail
    await flushDirtySheets();
    expect(getSetAside(id).map((s) => s.revision)).toEqual(["old"]);
    deleteSetAside(id);
    expect(getSetAside(id)).toEqual([]);
  });

  test("a second conflict adds its edits; the first ones are never replaced", async () => {
    const id = "storage/rotli/twice.xlsx";
    setParked(id, realPark("first"));
    setAsideParked(id);
    setParked(id, realPark("second"));
    setAsideParked(id);
    expect(getSetAside(id).map((s) => s.revision)).toEqual(["first", "second"]);
    // Save my edits as a copy writes one workbook per set-aside session
    const made: string[] = [];
    const last = await saveSetAsideAsCopy(id, async (name) => {
      made.push(name);
      return `storage/rotli/copy-${made.length}.xlsx`;
    });
    expect(made).toEqual(["twice (my edits).xlsx", "twice (my edits).xlsx"]);
    expect(last).toBe("storage/rotli/copy-2.xlsx");
    expect(getSetAside(id)).toEqual([]);
  });

  test("a CSV's set-aside edits survive as a workbook copy", async () => {
    const wb = fillFromCsvRows(newWorkbook(), "people", [
      ["name", "age"],
      ["Ana", "41"],
    ]);
    const model = workbookToModel(wb, "vault:wiki/people.csv");
    const idMap = buildSheetIdMap(wb, model);
    const sheetId = model.sheetOrder[0]!;
    const sheet = model.sheets[sheetId]!;
    const cells = sheet.cellData ?? {};
    cells[1] = { ...cells[1], 1: { v: "42" } };
    sheet.cellData = cells;
    const bytes = await setAsideCopyBytes({ wb, model, idMap, diskLen: 0, revision: "r", mode: "csv" });
    const back = await loadXlsx(bytes.buffer as ArrayBuffer);
    expect(back.worksheets[0]!.getCell(2, 2).value).toBe("42");
    expect(back.worksheets[0]!.getCell(2, 1).value).toBe("Ana");
  });

  test("the copy is a workbook named after the file", () => {
    expect(setAsideCopyName("storage/rotli/Budget.xlsx")).toBe("Budget (my edits).xlsx");
    expect(setAsideCopyName("vault:wiki/people.csv")).toBe("people (my edits).xlsx");
  });
});

describe("flushOnHide — a background save that fails says so", () => {
  test("a failed flush reports its reason", async () => {
    const reports: string[] = [];
    await flushOnHide(
      async () => {
        throw new Error("storage/rotli/a.xlsx: the file changed on disk");
      },
      (message) => reports.push(message),
    );
    expect(reports).toEqual([
      "Couldn’t save a spreadsheet in the background — storage/rotli/a.xlsx: the file changed on disk",
    ]);
  });

  test("a clean flush reports nothing", async () => {
    const reports: string[] = [];
    await flushOnHide(
      async () => {},
      (message) => reports.push(message),
    );
    expect(reports).toEqual([]);
  });
});
