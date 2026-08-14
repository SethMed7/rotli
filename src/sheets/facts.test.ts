// Facts-derivation locks for the sheet Details panel (feature D) — the panel
// must state only what is true: exact dims when fully parsed, "N+" when the
// parse cap truncated, widest-row columns for ragged CSV, and "—" whenever a
// probe or stamp is missing rather than a fabricated value.

import { describe, expect, test } from "bun:test";

import type { FileStat } from "../lib/tauri";
import {
  deriveSheetFacts,
  describeShape,
  formatBytes,
  formatStamp,
  sheetFormatLabel,
  sizeLine,
} from "./facts";
import type { SheetTable } from "./view";

const table = (over: Partial<SheetTable>): SheetTable => ({
  name: "Sheet1",
  rows: [
    ["a", "b"],
    ["1", "2"],
  ],
  truncated: false,
  ...over,
});

describe("deriveSheetFacts", () => {
  test("csv: comma delimiter, UTF-8, exact dims", () => {
    const f = deriveSheetFacts("csv", [table({})]);
    expect(f.format).toBe("CSV");
    expect(f.delimiter).toBe("comma");
    expect(f.encoding).toBe("UTF-8");
    expect(f.sheets).toEqual([{ name: "Sheet1", rows: 2, cols: 2, truncated: false }]);
  });

  test("tsv: tab delimiter", () => {
    expect(deriveSheetFacts("tsv", [table({})]).delimiter).toBe("tab");
  });

  test("xlsx: no delimiter/encoding claims, every sheet listed", () => {
    const f = deriveSheetFacts("xlsx", [table({ name: "Q1" }), table({ name: "Q2", rows: [["x"]] })]);
    expect(f.format).toBe("Excel workbook");
    expect(f.delimiter).toBeUndefined();
    expect(f.encoding).toBeUndefined();
    expect(f.sheets.map((s) => s.name)).toEqual(["Q1", "Q2"]);
  });

  test("ragged rows report the WIDEST row as the column count", () => {
    const f = deriveSheetFacts("csv", [table({ rows: [["a"], ["1", "2", "3"], []] })]);
    expect(f.sheets[0]?.cols).toBe(3);
    expect(f.sheets[0]?.rows).toBe(3);
  });

  test("an empty sheet is 0 × 0, not a crash", () => {
    expect(deriveSheetFacts("csv", [table({ rows: [] })]).sheets[0]).toEqual({
      name: "Sheet1",
      rows: 0,
      cols: 0,
      truncated: false,
    });
  });

  test("an unknown sheet extension falls back to the raw suffix", () => {
    expect(deriveSheetFacts("numbers", []).format).toBe(".numbers");
    expect(sheetFormatLabel("numbers")).toBe("");
  });
});

describe("describeShape — the one dims grammar", () => {
  test("exact counts pluralize correctly", () => {
    expect(describeShape({ name: "S", rows: 1, cols: 1, truncated: false })).toBe("1 row × 1 column");
    expect(describeShape({ name: "S", rows: 2500, cols: 14, truncated: false })).toBe(
      "2,500 rows × 14 columns",
    );
  });

  test("a truncated parse says N+ instead of implying an exact total", () => {
    expect(describeShape({ name: "S", rows: 2000, cols: 3, truncated: true })).toBe(
      "2,000+ rows × 3 columns",
    );
  });
});

describe("size and stamp formatting refuse to fabricate", () => {
  test("bytes → KB → MB with sane precision", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5_000_000)).toBe("4.8 MB");
    expect(formatBytes(-1)).toBe("—");
  });

  test("missing stamps and probes render as an em dash", () => {
    expect(formatStamp(null)).toBe("—");
    expect(formatStamp(undefined)).toBe("—");
    expect(formatStamp(0)).toBe("—");
    expect(sizeLine(null)).toBe("—");
  });

  test("a real stat reports its byte size", () => {
    const stat: FileStat = {
      len: 2048,
      revision: "r1",
      writable: true,
      lifecycleMutable: false,
      createdMs: null,
      modifiedMs: null,
    };
    expect(sizeLine(stat)).toBe("2.0 KB");
  });
});
