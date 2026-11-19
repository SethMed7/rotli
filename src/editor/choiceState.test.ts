import { describe, expect, test } from "bun:test";

import {
  choiceLineOf,
  choiceGlyph,
  CHOICE_RE,
  ORDERED_CHOICE_RE,
  optionLabel,
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

describe("choice groups read only their own lines", () => {
  test("a group edit walks the group, never the whole note", () => {
    const lines = ["# Plan", "", "- ( ) Red", "- (x) Blue", "- ( ) Green", "", ...Array(5000).fill("prose")];
    const read: number[] = [];
    const source = {
      length: lines.length,
      at: (index: number) => {
        read.push(index);
        return lines[index];
      },
    };
    expect(selectChoiceGroup(source, 2)).toEqual([
      { index: 2, line: "- (x) Red" },
      { index: 3, line: "- ( ) Blue" },
    ]);
    // the target, the group, and the one boundary line on each side
    expect(Math.max(...read)).toBeLessThanOrEqual(5);
    expect(Math.min(...read)).toBeGreaterThanOrEqual(1);
  });

  test("a negative index selects nothing (Array.at would wrap to the end)", () => {
    expect(selectChoiceGroup(["- ( ) A", "- ( ) B"], -1)).toBeNull();
  });
});

describe("what a screen reader names an option", () => {
  test("its text, without Markdown emphasis, links reduced to what they show", () => {
    expect(optionLabel("Red")).toBe("Red");
    expect(optionLabel("**Bold** and `code` and ~~gone~~")).toBe("Bold and code and gone");
    expect(optionLabel("See [[Pricing|the pricing note]] or [docs](https://x.test)")).toBe(
      "See the pricing note or docs",
    );
    expect(optionLabel("[[Q3 plan]]")).toBe("Q3 plan");
    expect(optionLabel("   ")).toBe("Empty option");
    expect(optionLabel("x".repeat(300))).toHaveLength(120);
  });
});
