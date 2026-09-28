// A reader's report (2026-09-28): bold a word, type plain text after it,
// select both, ⌘B → stray stars (`****hello** okay**`). Bold now works like a
// word processor: a partly bold selection becomes one bold span; an all-bold
// one (even part of a span) loses the bold.

import { describe, expect, test } from "bun:test";

import { toggleInlineMark } from "./commands";
import { markCoverage } from "./markRuns";

const BOLD = { open: "**", close: "**" };

function bold(line: string, a = 0, b = line.length) {
  const r = toggleInlineMark(line, a, b, "bold");
  return { line: r.line, selected: r.line.slice(r.selStart, r.selEnd) };
}

describe("bold over text that is partly bold", () => {
  test("bold + plain selected together becomes one bold span, and back", () => {
    const once = bold("**hello** okay world whayt is");
    expect(once).toEqual({ line: "**hello okay world whayt is**", selected: "hello okay world whayt is" });
    expect(bold(once.line).line).toBe("hello okay world whayt is");
  });

  test("plain + bold + plain joins into one span, absorbing the marks inside", () => {
    expect(bold("a **b** c **d** e").line).toBe("**a b c d e**");
  });

  test("a span that straddles the selection's edge joins it", () => {
    // select "lo wor": the bold "hello" reaches in from the left
    expect(bold("**hello** world", 5, 13).line).toBe("**hello wor**ld");
  });

  test("part of a bold span loses the bold on its own; the rest stays bold", () => {
    expect(bold("**hello okay world**", 8, 12).line).toBe("**hello** okay **world**");
    expect(bold("**hello okay world**", 2, 7).line).toBe("hello **okay world**");
  });

  test("an empty `****` a past toggle left is cleaned up by the next one", () => {
    expect(bold("****hello** okay world**").line).toBe("**hello okay world**");
  });

  test("italic and other marks keep their place around the bold", () => {
    expect(bold("***x***", 3, 4).line).toBe("*x*");
    expect(bold("*hi* there").line).toBe("***hi* there**");
  });

  test("strike, highlight, and underline read the same way", () => {
    expect(toggleInlineMark("~~a~~ b", 0, 7, "strike").line).toBe("~~a b~~");
    expect(toggleInlineMark("==a== b", 0, 7, "highlight").line).toBe("==a b==");
    expect(toggleInlineMark("<u>a</u> b", 0, 10, "underline").line).toBe("<u>a b</u>");
  });

  test("coverage tells all, some, or none", () => {
    expect(markCoverage("**a** b", 0, 7, BOLD)).toBe("some");
    expect(markCoverage("**a b**", 0, 7, BOLD)).toBe("all");
    expect(markCoverage("a b", 0, 3, BOLD)).toBe("none");
  });
});
