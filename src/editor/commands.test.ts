// The pure format-command grammar (commands.ts) — block toggles must respect
// leading indentation (a Tab-nested "  - child" toggles its OWN marker, never
// stacks a second one at column 0 — paper-cut sweep 2026-07-27) and the
// multi-line policy applyBlockToggleAll drives the format bar's selection
// behavior: mixed lines turn ON, uniformly-on lines turn OFF, blanks are left
// alone.

import { describe, expect, test } from "bun:test";

import { applyBlockToggle, applyBlockToggleAll, blockToggleActive } from "./commands";

describe("applyBlockToggle on indented lines", () => {
  test("toggling bullet OFF on a nested item removes the marker, keeps the indent", () => {
    expect(applyBlockToggle("  - child", "bullet").line).toBe("  child");
  });

  test("toggling checklist on a nested bullet swaps the marker after the indent", () => {
    expect(applyBlockToggle("  - child", "checklist").line).toBe("  - [ ] child");
  });

  test("toggling checklist OFF on a nested task keeps the indent", () => {
    expect(applyBlockToggle("  - [ ] child", "checklist").line).toBe("  child");
  });

  test("toggling numbered on a nested numbered item turns it off", () => {
    expect(applyBlockToggle("  1. a", "numbered").line).toBe("  a");
  });

  test("delta reflects the prefix change so the caret stays on its character", () => {
    const on = applyBlockToggle("  child", "bullet");
    expect(on.line).toBe("  - child");
    expect(on.delta).toBe(2);
    const off = applyBlockToggle("  - child", "bullet");
    expect(off.delta).toBe(-2);
  });

  test("format toggles replace a result prefix instead of stacking onto it", () => {
    expect(applyBlockToggle("  - [ ][x] child", "bullet").line).toBe("  - child");
    expect(applyBlockToggle("2. [x][ ] child", "checklist").line).toBe("- [ ] child");
    expect(applyBlockToggle("- [True][x False] child", "numbered").line).toBe("1. child");
  });

  test("format toggles replace a multiple-choice prefix instead of stacking onto it", () => {
    expect(applyBlockToggle("  - (x) child", "bullet").line).toBe("  - child");
    expect(applyBlockToggle("2. ( ) child", "checklist").line).toBe("- [ ] child");
    expect(applyBlockToggle("- [#x] child", "bullet").line).toBe("- child");
    expect(applyBlockToggle("- [##] child", "numbered").line).toBe("1. child");
    expect(applyBlockToggle("- [True|x False] child", "checklist").line).toBe("- [ ] child");
  });
});

describe("blockToggleActive on indented lines", () => {
  test("sees the marker through leading indentation", () => {
    expect(blockToggleActive("  - [ ] child", "checklist")).toBe(true);
    expect(blockToggleActive("  - child", "bullet")).toBe(true);
    expect(blockToggleActive("    2. deep", "numbered")).toBe(true);
    expect(blockToggleActive("  - child", "checklist")).toBe(false);
  });

  test("a two-choice result is not misreported as an ordinary bullet", () => {
    expect(blockToggleActive("- [ ][ ] case", "bullet")).toBe(false);
    expect(blockToggleActive("2. [ ][x] case", "numbered")).toBe(false);
    expect(blockToggleActive("- [True][False] case", "bullet")).toBe(false);
  });

  test("a multiple-choice option is not misreported as a generic list", () => {
    expect(blockToggleActive("- ( ) option", "bullet")).toBe(false);
    expect(blockToggleActive("2. (x) option", "numbered")).toBe(false);
    expect(blockToggleActive("- [#] option", "bullet")).toBe(false);
    expect(blockToggleActive("- [##x] option", "bullet")).toBe(false);
    expect(blockToggleActive("- [|x] option", "bullet")).toBe(false);
  });
});

describe("applyBlockToggleAll (multi-line selection policy)", () => {
  test("turns every non-blank line on when any line is missing the marker", () => {
    expect(applyBlockToggleAll(["alpha", "beta", "gamma"], "checklist")).toEqual([
      "- [ ] alpha",
      "- [ ] beta",
      "- [ ] gamma",
    ]);
  });

  test("mixed selection: already-marked lines are left untouched (null)", () => {
    expect(applyBlockToggleAll(["- [ ] a", "b"], "checklist")).toEqual([null, "- [ ] b"]);
  });

  test("uniformly-on selection toggles every line off", () => {
    expect(applyBlockToggleAll(["- [ ] a", "  - [x] b"], "checklist")).toEqual(["a", "  b"]);
  });

  test("blank lines never receive a marker", () => {
    expect(applyBlockToggleAll(["alpha", "", "beta"], "bullet")).toEqual(["- alpha", null, "- beta"]);
  });
});
