// The shared block grammar must read TAB-indented lists (the maintainer, 2026-07-28:
// "shift tab on bullets is very buggy" — notes written by external editors and
// LLMs indent with tabs, which the space-only grammar treated as raw
// paragraphs: no bullet, dead Shift-Tab, Tab inserting a soft tab).

import { describe, expect, test } from "bun:test";

import { parseBlock } from "./render";

const CUSTOM_AMBER = `#${"E3B341"}`;

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

describe("parseBlock — two-choice results", () => {
  test("plain result rows expose their exclusive state and content", () => {
    const unanswered = parseBlock("- [ ][ ] API boots");
    expect(unanswered.kind).toBe("result");
    expect(unanswered.resultState).toBe("unanswered");
    expect(unanswered.text).toBe("API boots");
    expect(unanswered.prefixLen).toBe("- [ ][ ] ".length);

    expect(parseBlock("- [ ][x] API fails").resultState).toBe("no");
    expect(parseBlock("- [X][ ] API passes").resultState).toBe("yes");
  });

  test("ordered and nested result rows retain their marker and depth", () => {
    const block = parseBlock("\t4. [x][ ] nested pass");
    expect(block.kind).toBe("result");
    expect(block.marker).toBe("4.");
    expect(block.indent).toBe(2);
    expect(block.resultState).toBe("yes");
  });

  test("both sides selected fails closed as ordinary list text", () => {
    const plain = parseBlock("- [x][x] ambiguous");
    expect(plain.kind).toBe("bullet");
    expect(plain.text).toBe("[x][x] ambiguous");
    expect(parseBlock("2. [x][x] ambiguous").kind).toBe("numbered");
  });

  test("ordinary task rows remain tasks", () => {
    expect(parseBlock("- [ ] todo").kind).toBe("task");
    expect(parseBlock("1. [x] done").kind).toBe("task");
  });

  test("labeled result rows expose every option without swallowing the question", () => {
    const block = parseBlock(`- [True:green][Draw:${CUSTOM_AMBER}][x False:red] Release?`);
    expect(block.kind).toBe("result");
    expect(block.prefixLen).toBe(`- [True:green][Draw:${CUSTOM_AMBER}][x False:red] `.length);
    expect(block.text).toBe("Release?");
    expect(block.resultOptions?.map(({ label, selected, color }) => ({ label, selected, color }))).toEqual([
      { label: "True", selected: false, color: "green" },
      { label: "Draw", selected: false, color: CUSTOM_AMBER },
      { label: "False", selected: true, color: "red" },
    ]);
  });
});

describe("parseBlock — multiple-choice rows", () => {
  test("plain options expose selected state and content", () => {
    const open = parseBlock("- ( ) Red");
    expect(open.kind).toBe("choice");
    expect(open.choiceSelected).toBe(false);
    expect(open.text).toBe("Red");
    expect(open.prefixLen).toBe(6);

    const selected = parseBlock("- (X) Blue");
    expect(selected.kind).toBe("choice");
    expect(selected.choiceSelected).toBe(true);
  });

  test("ordered and nested options retain their marker and depth", () => {
    const block = parseBlock("\t12. (x) Blue");
    expect(block.kind).toBe("choice");
    expect(block.marker).toBe("12.");
    expect(block.indent).toBe(2);
    expect(block.text).toBe("Blue");
    expect(block.choiceVariant).toBe("legacy");
  });

  test("ordinary parenthesized list text remains an ordinary list", () => {
    expect(parseBlock("- (maybe) later").kind).toBe("bullet");
    expect(parseBlock("2. (yes) later").kind).toBe("numbered");
  });
});

describe("parseBlock — hash choices and toggles", () => {
  test("an optional multi-choice question remains distinct from its answers", () => {
    expect(parseBlock("- [##?] Which channels should we use?")).toMatchObject({
      kind: "choice",
      choiceVariant: "prompt",
      text: "Which channels should we use?",
      prefixLen: 8,
      indent: 0,
    });
  });

  test("new one-of-many and many-of-many markers stay distinct", () => {
    const radio = parseBlock("- [#x] Blue");
    expect(radio).toMatchObject({
      kind: "choice",
      choiceVariant: "radio",
      choiceSelected: true,
      text: "Blue",
    });
    const multi = parseBlock("  3. [##] Green");
    expect(multi).toMatchObject({
      kind: "choice",
      choiceVariant: "multi",
      choiceSelected: false,
      marker: "3.",
      indent: 2,
    });
  });

  test("compact and labeled switches expose their active state", () => {
    expect(parseBlock("- [|x] Alerts")).toMatchObject({
      kind: "toggle",
      toggleOn: false,
      toggleCompact: true,
      text: "Alerts",
    });
    expect(parseBlock("2. [x True:green|False:red] Sync")).toMatchObject({
      kind: "toggle",
      toggleOn: true,
      toggleCompact: false,
      toggleLabels: ["True", "False"],
      marker: "2.",
    });
  });
});
