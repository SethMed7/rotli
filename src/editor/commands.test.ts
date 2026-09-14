// The pure format-command grammar (commands.ts) — block toggles must respect
// leading indentation (a Tab-nested "  - child" toggles its OWN marker, never
// stacks a second one at column 0 — paper-cut sweep 2026-07-27) and the
// multi-line policy applyBlockToggleAll drives the format bar's selection
// behavior: mixed lines turn ON, uniformly-on lines turn OFF, blanks are left
// alone.

import { describe, expect, test } from "bun:test";

import {
  applyBlockToggle,
  applyBlockToggleAll,
  blockToggleActive,
  isMarkActive,
  toggleInlineMark,
} from "./commands";

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

describe("isMarkActive needs a closed pair (the format bar's B must not light on a lone opener)", () => {
  test("an unclosed bold opener is not bold", () => {
    expect(isMarkActive("**Testing", 5, "bold")).toBe(false);
  });

  test("a caret inside a closed bold span is bold", () => {
    expect(isMarkActive("**Testing**", 5, "bold")).toBe(true);
    expect(isMarkActive("a **b** c", 4, "bold")).toBe(true);
  });

  test("past a closed span with a trailing lone opener is not bold", () => {
    expect(isMarkActive("**a** then **b", 13, "bold")).toBe(false);
  });

  test("an unclosed <u> is not underlined; a closed one is", () => {
    expect(isMarkActive("<u>open", 5, "underline")).toBe(false);
    expect(isMarkActive("<u>open</u>", 5, "underline")).toBe(true);
  });

  test("italic ignores the bold pairs and still needs its closer", () => {
    expect(isMarkActive("*lean", 3, "italic")).toBe(false);
    expect(isMarkActive("*lean*", 3, "italic")).toBe(true);
  });
});

describe("the numbered toggle and lettered items", () => {
  test("a lettered item reads as numbered and toggles off to its text", () => {
    expect(blockToggleActive("b. item", "numbered")).toBe(true);
    expect(applyBlockToggle("  a. child", "numbered").line).toBe("  child");
  });
  test("switching a lettered item to a bullet replaces its marker", () => {
    expect(applyBlockToggle("a. item", "bullet").line).toBe("- item");
  });
  test("an abbreviation is not a list item", () => {
    expect(blockToggleActive("e.g. item", "numbered")).toBe(false);
  });
});

describe("stacked marks (⌘B then ⌘I then ⌘U keep every mark)", () => {
  const apply = (line: string, sel: [number, number], mark: Parameters<typeof toggleInlineMark>[3]) => {
    const r = toggleInlineMark(line, sel[0], sel[1], mark);
    return { line: r.line, sel: [r.selStart, r.selEnd] as [number, number] };
  };

  test("italic on a bold selection adds a star instead of stripping the bold", () => {
    const bold = apply("hello world", [0, 11], "bold");
    expect(bold.line).toBe("**hello world**");
    const both = apply(bold.line, bold.sel, "italic");
    expect(both.line).toBe("***hello world***");
    const all = apply(both.line, both.sel, "underline");
    expect(all.line).toBe("***<u>hello world</u>***");
  });

  test("bold-italic unwraps one mark at a time", () => {
    expect(apply("***x***", [3, 4], "italic").line).toBe("**x**");
    expect(apply("***x***", [3, 4], "bold").line).toBe("*x*");
    expect(apply("*x*", [1, 2], "bold").line).toBe("***x***");
  });

  test("a mark on inline code wraps outside the backticks and toggles back", () => {
    const code = apply("code", [0, 4], "code");
    expect(code.line).toBe("`code`");
    const struck = apply(code.line, code.sel, "strike");
    expect(struck.line).toBe("~~`code`~~");
    expect(struck.line.slice(struck.sel[0], struck.sel[1])).toBe("code");
    expect(apply(struck.line, struck.sel, "strike").line).toBe("`code`");
  });
});

describe("toggling one mark out of a stack reaches past the other marks' delimiters", () => {
  test("italic comes off bold-italic-underline without touching the underline", () => {
    const line = "***<u>hello world</u>***";
    const r = toggleInlineMark(line, 6, 17, "italic");
    expect(r.line).toBe("**<u>hello world</u>**");
    expect(r.line.slice(r.selStart, r.selEnd)).toBe("hello world");
  });
  test("bold comes off through an underline and a highlight", () => {
    const line = "**==<u>x</u>==**";
    const r = toggleInlineMark(line, 7, 8, "bold");
    expect(r.line).toBe("==<u>x</u>==");
    expect(r.line.slice(r.selStart, r.selEnd)).toBe("x");
  });
  test("strike comes off code it wraps, and a fresh mark still wraps innermost", () => {
    expect(toggleInlineMark("~~`code`~~", 3, 7, "strike").line).toBe("`code`");
    expect(toggleInlineMark("**<u>x</u>**", 5, 6, "highlight").line).toBe("**<u>==x==</u>**");
  });
});
