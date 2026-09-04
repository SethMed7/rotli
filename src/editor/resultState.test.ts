import { describe, expect, test } from "bun:test";

import {
  chooseResult,
  ORDERED_RESULT_RE,
  RESULT_LINE_RE,
  RESULT_RE,
  resultGlyph,
  parseResultLine,
  resultStateOf,
  resultTextParts,
} from "./resultState";

const CUSTOM_AMBER = `#${"E3B341"}`;

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

  test("reads portable labeled choices with semantic and custom colors", () => {
    expect(parseResultLine(`- [True:green][Draw:${CUSTOM_AMBER}][False:red] Ship it`)).toEqual({
      indent: "",
      marker: "- ",
      prefixLen: `- [True:green][Draw:${CUSTOM_AMBER}][False:red] `.length,
      text: "Ship it",
      compact: false,
      options: [
        { label: "True", selected: false, color: "green", source: "True:green" },
        { label: "Draw", selected: false, color: CUSTOM_AMBER, source: `Draw:${CUSTOM_AMBER}` },
        { label: "False", selected: false, color: "red", source: "False:red" },
      ],
    });
    expect(parseResultLine("  3. [x Ready][Later:neutral] Decision")?.options[0]).toEqual({
      label: "Ready",
      selected: true,
      color: null,
      source: "Ready",
    });
  });

  test("choosing a labeled option preserves labels and colors and clears its siblings", () => {
    expect(chooseResult(`- [x True:green][Draw:${CUSTOM_AMBER}][False:red] Ship it`, 1)).toBe(
      `- [True:green][x Draw:${CUSTOM_AMBER}][False:red] Ship it`,
    );
  });

  test("labeled results fail closed when selection or color syntax is ambiguous", () => {
    expect(parseResultLine("- [x True][x False] Pick one")).toBeNull();
    expect(parseResultLine("- [True:#12][False:red] Pick one")).toBeNull();
    expect(parseResultLine("- [True:purple][False:red] Pick one")).toBeNull();
    expect(parseResultLine("- [Only one] not a result")).toBeNull();
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
