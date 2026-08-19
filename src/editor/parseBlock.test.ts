// The shared block grammar must read TAB-indented lists (the maintainer, 2026-07-28:
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

// GFM's ordered task ("1. [ ] x") is a TASK that keeps its number as marker —
// before 2026-08-03 it parsed as plain numbered and showed a literal "[ ]"
// (the maintainer's KEK-rotation checklist).
describe("parseBlock — ordered tasks", () => {
  test("an open ordered task is a task with its number as marker", () => {
    const b = parseBlock("1. [ ] Generate the new key");
    expect(b.kind).toBe("task");
    expect(b.state).toBe("open");
    expect(b.marker).toBe("1.");
    expect(b.prefixLen).toBe("1. [ ] ".length);
    expect(b.text).toBe("Generate the new key");
  });

  test("a checked ordered task is done; multi-digit numbers keep their glyph", () => {
    expect(parseBlock("2. [x] restart the API").state).toBe("done");
    expect(parseBlock("12. [X] later step").marker).toBe("12.");
  });

  test("indented ordered tasks nest like every other list kind", () => {
    const b = parseBlock("  3. [ ] re-seal");
    expect(b.kind).toBe("task");
    expect(b.indent).toBe(2);
    expect(b.prefixLen).toBe(2 + "3. [ ] ".length);
  });

  test("a plain numbered item and a bullet task are untouched", () => {
    expect(parseBlock("1. no box here").kind).toBe("numbered");
    expect(parseBlock("1. no box here").marker).toBe("1.");
    const t = parseBlock("- [ ] todo");
    expect(t.kind).toBe("task");
    expect(t.marker).toBeUndefined();
  });

  test("a malformed box stays a numbered item, literal", () => {
    expect(parseBlock("1. [] not gfm").kind).toBe("numbered");
    expect(parseBlock("1.[ ] no space").kind).toBe("para");
  });
});

// `[/]` — in progress (2026-08-04, from ZenNotes). Until this landed, a typed
// `[/]` parsed as DONE, because the state was a boolean and anything that
// wasn't a space counted as checked.
describe("parseBlock — in progress", () => {
  test("`- [/]` is doing, not done", () => {
    const b = parseBlock("- [/] halfway there");
    expect(b.kind).toBe("task");
    expect(b.state).toBe("doing");
    expect(b.text).toBe("halfway there");
  });

  test("an ordered task can be in progress too", () => {
    expect(parseBlock("4. [/] drafting").state).toBe("doing");
  });

  test("a nested one keeps its depth", () => {
    expect(parseBlock("  - [/] sub").indent).toBe(2);
  });
});
