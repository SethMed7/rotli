// parseCsvExact — the sheet EDITOR's csv load path. The contract under test is
// round-trip fidelity: what loads is EXACTLY what Save writes back, because the
// editor overwrites the real file. (The read-only parseWorkbook path is allowed
// to coerce/cap — this one is not: SheetJS turned "007" into "7" and truncated
// at 2000 rows, and saving that destroyed the untouched rest of the file.)

import { describe, expect, test } from "bun:test";
import { csvTextFromRows } from "./sheetEdit";
import { parseCsvExact } from "./sheets";

describe("parseCsvExact", () => {
  test("no type coercion — leading zeros and >15-digit ids stay text", () => {
    const rows = parseCsvExact("code,idnum\n007,9007199254740993\n");
    expect(rows).toEqual([
      ["code", "idnum"],
      ["007", "9007199254740993"],
    ]);
  });

  test("nothing is sliced and blank rows survive (the 3000-row repro)", () => {
    const lines = ["a,b"];
    for (let i = 0; i < 3000; i++) {
      lines.push(`x${i},y${i}`);
      if (i % 100 === 0) lines.push(""); // blank separator rows
    }
    const csv = `${lines.join("\n")}\n`;
    const rows = parseCsvExact(csv);
    expect(rows.length).toBe(lines.length);
    // and the whole thing round-trips byte-identically through the serializer
    expect(csvTextFromRows(rows)).toBe(csv);
  });

  test("RFC-4180 quoting: commas, escaped quotes, embedded newlines", () => {
    expect(parseCsvExact('"a,b",c\n')).toEqual([["a,b", "c"]]);
    expect(parseCsvExact('"say ""hi""",x\n')).toEqual([['say "hi"', "x"]]);
    expect(parseCsvExact('"line\nbreak",c\n')).toEqual([["line\nbreak", "c"]]);
    expect(csvTextFromRows(parseCsvExact('"line\nbreak",c\n'))).toBe('"line\nbreak",c\n');
  });

  test("edges: empty input, trailing newline, ragged/empty fields, CRLF", () => {
    expect(parseCsvExact("")).toEqual([]);
    expect(parseCsvExact("a,b")).toEqual([["a", "b"]]); // no trailing newline
    expect(parseCsvExact("a,b\n")).toEqual([["a", "b"]]); // no phantom last row
    expect(parseCsvExact("a,,\n")).toEqual([["a", "", ""]]);
    expect(csvTextFromRows(parseCsvExact("a,,\n"))).toBe("a,,\n"); // trailing empties kept
    expect(parseCsvExact("a\r\nb\r\n")).toEqual([["a"], ["b"]]); // CRLF → LF normalization
    expect(parseCsvExact('""\n')).toEqual([[""]]);
    expect(parseCsvExact('"unterminated')).toEqual([["unterminated"]]);
  });
});
