import { describe, expect, test } from "bun:test";

import {
  choiceLineOf,
  choiceGlyph,
  CHOICE_RE,
  ORDERED_CHOICE_RE,
  selectChoiceGroup,
  setChoiceSelected,
} from "./choiceState";

describe("single-choice Markdown groups", () => {
  test("reads plain, ordered, selected, and nested options", () => {
    expect(CHOICE_RE.exec("- ( ) Red")?.[1]).toBe(" ");
    expect(ORDERED_CHOICE_RE.exec("12. (X) Blue")?.slice(1)).toEqual(["12", "X"]);
    expect(choiceLineOf("\t- (x) nested")).toEqual({ indent: 2, selected: true, prefixLen: 7 });
    expect(choiceGlyph(false)).toBe("○");
    expect(choiceGlyph(true)).toBe("●");
  });

  test("rewrites only the radio mark", () => {
    expect(setChoiceSelected("  - ( ) Red", true)).toBe("  - (x) Red");
    expect(setChoiceSelected("3. (X) Blue", false)).toBe("3. ( ) Blue");
    expect(setChoiceSelected("- [ ] task", true)).toBeNull();
  });

  test("selects one adjacent same-indent option and clears the rest", () => {
    const lines = ["Question", "- (x) Red", "- ( ) Blue", "- (x) Green", "", "- (x) Other group"];
    expect(selectChoiceGroup(lines, 2)).toEqual([
      { index: 1, line: "- ( ) Red" },
      { index: 2, line: "- (x) Blue" },
      { index: 3, line: "- ( ) Green" },
    ]);
  });

  test("a blank or different indent ends the exclusive group", () => {
    const lines = ["- (x) Parent", "  - (x) Nested", "- ( ) Sibling", "", "- (x) Separate"];
    expect(selectChoiceGroup(lines, 2)).toEqual([{ index: 2, line: "- (x) Sibling" }]);
    expect(selectChoiceGroup(lines, 1)).toEqual([]);
  });

  test("an unrelated or missing target is refused", () => {
    expect(selectChoiceGroup(["plain"], 0)).toBeNull();
    expect(selectChoiceGroup([], 3)).toBeNull();
  });
});
