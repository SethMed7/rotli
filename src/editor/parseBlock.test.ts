// The shared block grammar must read TAB-indented lists (Seth, 2026-07-28:
// "shift tab on bullets is very buggy" — notes written by external editors and
// LLMs indent with tabs, which the space-only grammar treated as raw
// paragraphs: no bullet, dead Shift-Tab, Tab inserting a soft tab).

import { describe, expect, test } from "bun:test";
import { parseBlock } from "./render";

describe("parseBlock — tab-tolerant list indents", () => {
  test("a tab-indented bullet is a bullet (tab = one nesting level)", () => {
    const b = parseBlock("\t- child");
    expect(b.kind).toBe("bullet");
    expect(b.prefixLen).toBe(3); // char offsets: 1 tab + "- "
    expect(b.indent).toBe(2); // depth columns: one level
  });

  test("two tabs nest two levels; mixed tab+space counts columns", () => {
    expect(parseBlock("\t\t- deep").indent).toBe(4);
    expect(parseBlock("\t  - mixed").indent).toBe(4);
  });

  test("tab-indented tasks and numbered items classify too", () => {
    expect(parseBlock("\t- [ ] todo").kind).toBe("task");
    expect(parseBlock("\t1. first").kind).toBe("numbered");
    expect(parseBlock("\t> quoted").kind).toBe("quote");
  });

  test("space indents are unchanged", () => {
    const b = parseBlock("  - child");
    expect(b.kind).toBe("bullet");
    expect(b.prefixLen).toBe(4);
    expect(b.indent).toBe(2);
  });
});
