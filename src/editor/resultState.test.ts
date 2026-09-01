import { describe, expect, test } from "bun:test";

import {
  chooseResult,
  ORDERED_RESULT_RE,
  RESULT_LINE_RE,
  RESULT_RE,
  resultGlyph,
  resultStateOf,
  resultTextParts,
} from "./resultState";

describe("two-choice result grammar", () => {
  test("reads unanswered, no, and yes while accepting a capital X", () => {
    expect(resultStateOf(" ", " ")).toBe("unanswered");
    expect(resultStateOf("x", " ")).toBe("yes");
    expect(resultStateOf(" ", "X")).toBe("no");
  });

  test("refuses an externally edited pair with both choices selected", () => {
    expect(resultStateOf("x", "x")).toBeNull();
  });

  test("matches plain, ordered, and indented result prefixes", () => {
    expect(RESULT_RE.exec("- [ ][x] fails")?.slice(1)).toEqual([" ", "x"]);
    expect(ORDERED_RESULT_RE.exec("12. [x][ ] passes")?.slice(1)).toEqual(["12", "x", " "]);
    expect(RESULT_LINE_RE.exec("  - [ ][ ] nested")?.slice(1)).toEqual(["  ", "- ", " ", " "]);
  });

  test("choosing one side clears the other and preserves the row", () => {
    expect(chooseResult("  - [ ][ ] API boots", "no")).toBe("  - [ ][x] API boots");
    expect(chooseResult("3. [ ][x] API boots", "yes")).toBe("3. [x][ ] API boots");
  });

  test("a malformed or unrelated line is never rewritten", () => {
    expect(chooseResult("- [x][x] ambiguous", "yes")).toBeNull();
    expect(chooseResult("- [ ] ordinary task", "yes")).toBeNull();
  });

  test("static markers keep every state readable", () => {
    expect(resultGlyph("unanswered")).toBe("×/✓");
    expect(resultGlyph("no")).toBe("×");
    expect(resultGlyph("yes")).toBe("✓");
  });

  test("an em-dash suffix remains an ordinary portable reason", () => {
    expect(resultTextParts("API boots")).toEqual({ label: "API boots", reason: null });
    expect(resultTextParts("API boots — timed out after 30 seconds")).toEqual({
      label: "API boots",
      reason: "timed out after 30 seconds",
    });
  });
});
