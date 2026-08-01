// parseCsvExact — round-trip fidelity for the edit path.

import { describe, expect, test } from "bun:test";

import { csvTextFromRows, parseCsvExact } from "./csv";

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
      if (i % 100 === 0) lines.push("");
    }
    const csv = `${lines.join("\n")}\n`;
    const rows = parseCsvExact(csv);
    expect(rows.length).toBe(lines.length);
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
    expect(parseCsvExact("a,b")).toEqual([["a", "b"]]);
    expect(parseCsvExact("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsvExact("a,,\n")).toEqual([["a", "", ""]]);
    expect(csvTextFromRows(parseCsvExact("a,,\n"))).toBe("a,,\n");
    expect(parseCsvExact("a\r\nb\r\n")).toEqual([["a"], ["b"]]);
    expect(parseCsvExact('""\n')).toEqual([[""]]);
    expect(parseCsvExact('"unterminated')).toEqual([["unterminated"]]);
  });
});
