// The text-grammar keymap, exercised through a minimal fake view (the commands
// only read view.state and call view.dispatch). press() mirrors CodeMirror's
// precedence: bindings for a key run in rotliKeymap order until one consumes.
// Locks the paper-cut sweep fixes (2026-07-27): fenced code is grammar-free,
// numbered lists renumber on Enter, the empty-item exit ramp needs the caret
// past the marker, the task shorthand normalizes tabs and upgrades bullets,
// and Tab is never stuck on a ragged table row.

import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rotliKeymap } from "./cmKeymap";

type FakeView = EditorView & { state: EditorState };

function viewOf(doc: string, head: number, anchor = head): FakeView {
  let state = EditorState.create({ doc, selection: EditorSelection.range(anchor, head) });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  } as unknown as FakeView;
}

function press(view: FakeView, key: string, shift = false): boolean {
  for (const b of rotliKeymap) {
    if (b.key !== key) continue;
    const run = shift ? b.shift : b.run;
    if (run?.(view as EditorView)) return true;
  }
  return false;
}

const text = (view: FakeView) => view.state.doc.toString();
const head = (view: FakeView) => view.state.selection.main.head;

describe("fenced code is grammar-free (#8)", () => {
  test("Space after [] inside a fence types normally (never becomes a task)", () => {
    const doc = "```js\n[]\n```";
    const v = viewOf(doc, doc.indexOf("[]") + 2);
    expect(press(v, "Space")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Enter after a dash line inside a fence never continues a list", () => {
    const doc = "```yaml\n- item\n```";
    const v = viewOf(doc, doc.indexOf("- item") + 6);
    expect(press(v, "Enter")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Tab on a dash line inside a fence is a soft tab at the caret, not a line indent", () => {
    const doc = "```yaml\n- item\n```";
    const at = doc.indexOf("- item") + 6;
    const v = viewOf(doc, at);
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("```yaml\n- item  \n```");
  });
});

describe("numbered lists renumber on Enter (#9)", () => {
  test("inserting an item mid-list bumps every following sibling", () => {
    const doc = "1. alpha\n2. beta\n3. gamma";
    const v = viewOf(doc, doc.indexOf("alpha") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. alpha\n2. \n3. beta\n4. gamma");
  });

  test("nested deeper items ride along untouched; renumbering stops at the list's end", () => {
    const doc = "1. alpha\n  1. deep\n2. beta\n\n1. other";
    const v = viewOf(doc, doc.indexOf("alpha") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. alpha\n2. \n  1. deep\n3. beta\n\n1. other");
  });

  test("bullet Enter still carries a plain marker (no renumber pass)", () => {
    const doc = "- alpha\n- beta";
    const v = viewOf(doc, doc.indexOf("alpha") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("- alpha\n- \n- beta");
  });
});

describe("the empty-item exit ramp needs the caret past the marker (#11)", () => {
  test("Enter at column 0 of an empty item falls through (default newline above)", () => {
    const doc = "- alpha\n- ";
    const v = viewOf(doc, doc.indexOf("\n") + 1); // start of line 2
    expect(press(v, "Enter")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Enter after the marker of an empty item still exits the list", () => {
    const doc = "- alpha\n- ";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("- alpha\n");
  });
});

describe("the []+Space task shorthand (#14, #15)", () => {
  test("normalizes a pasted tab indent into spaces so the task is a real task", () => {
    const doc = "\t[]";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Space")).toBe(true);
    expect(text(v)).toBe("  - [ ] ");
  });

  test("upgrades an existing bullet: '- []'+Space becomes a task", () => {
    const doc = "- []";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Space")).toBe(true);
    expect(text(v)).toBe("- [ ] ");
    expect(head(v)).toBe(6);
  });

  test("an indented bullet upgrades in place", () => {
    const doc = "  - []";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Space")).toBe(true);
    expect(text(v)).toBe("  - [ ] ");
  });
});

describe("Tab on a ragged table row (#3)", () => {
  test("skips the missing cells and appends a row instead of sticking", () => {
    const doc = "| a | b | c |\n| --- | --- | --- |\n| x |";
    const v = viewOf(doc, doc.indexOf("x"));
    expect(press(v, "Tab")).toBe(true);
    // the row was ragged and 'x' was the last real cell → Tab grows the table
    expect(v.state.doc.lines).toBe(4);
    expect(text(v)).toContain("x");
  });

  test("a full row still hops cell to cell", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const v = viewOf(doc, doc.indexOf("1"));
    expect(press(v, "Tab")).toBe(true);
    const sel = v.state.selection.main;
    expect(text(v).slice(sel.from, sel.to)).toBe("2");
  });
});
