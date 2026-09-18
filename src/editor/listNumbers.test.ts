// Ordered lists count on their own: delete an item and the rest close ranks,
// nest a run and it starts at 1, toggle five lines to "1." and they read
// 1–5. Undo and programmatic loads pass through untouched.
import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState, Text } from "@codemirror/state";

import { listNumbering, renumberLines, renumberRunAt, widestOrdinalInRun } from "./listNumbers";

const apply = (doc: string, changes: { from: number; to: number; insert: string }[]) => {
  let out = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from))
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
};
const renumber = (doc: string) =>
  apply(doc, renumberLines(Text.of(doc.split("\n")), 1, doc.split("\n").length));

describe("renumberLines (pure)", () => {
  test("a gap closes: 1 2 3 5 6 → 1 2 3 4 5", () => {
    expect(renumber("1. a\n2. b\n3. c\n5. d\n6. e")).toBe("1. a\n2. b\n3. c\n4. d\n5. e");
  });
  test("all-ones read as a sequence (the toolbar toggle wrote 1. on every line)", () => {
    expect(renumber("1. a\n1. b\n1. c")).toBe("1. a\n2. b\n3. c");
  });
  test("a nested run starts at 1 and counts; the parent run is untouched by it", () => {
    expect(renumber("1. Sale\n  2. Refund\n  2. Partial\n  9. Void\n2. Auth")).toBe(
      "1. Sale\n  1. Refund\n  2. Partial\n  3. Void\n2. Auth",
    );
  });
  test("a top-level run keeps its starting number", () => {
    expect(renumber("5. e\n5. f\n9. g")).toBe("5. e\n6. f\n7. g");
  });
  test("a blank line or prose ends a run; the next list starts on its own", () => {
    expect(renumber("1. a\n3. b\n\n1. x\n3. y\nprose\n7. z\n9. w")).toBe(
      "1. a\n2. b\n\n1. x\n2. y\nprose\n7. z\n8. w",
    );
  });
  test("ordered tasks, results, and choices carry their numbers too", () => {
    expect(renumber("1. [ ] a\n1. [x] b\n1. ( ) c\n1. [ ][ ] d")).toBe(
      "1. [ ] a\n2. [x] b\n3. ( ) c\n4. [ ][ ] d",
    );
  });
  test("tab-indented nesting counts like two-space nesting", () => {
    expect(renumber("1. a\n\t1. x\n\t1. y\n1. b")).toBe("1. a\n\t1. x\n\t2. y\n2. b");
  });
  test("bullets and deeper prose ride along without breaking the run", () => {
    expect(renumber("1. a\n  - note\n  continued\n1. b")).toBe("1. a\n  - note\n  continued\n2. b");
  });
  test("renumberRunAt on a non-list line is a no-op", () => {
    expect(renumberRunAt(Text.of(["prose", "1. a"]), 1)).toEqual([]);
  });
});

describe("listNumbering (transaction filter)", () => {
  const stateOf = (doc: string) =>
    EditorState.create({ doc, selection: EditorSelection.cursor(0), extensions: [listNumbering] });

  test("deleting an item renumbers the rest in the same transaction", () => {
    const doc = "1. a\n2. b\n3. c\n4. d";
    const s = stateOf(doc);
    const from = doc.indexOf("2. b");
    const to = doc.indexOf("3. c");
    const tr = s.update({ changes: { from, to }, userEvent: "delete" });
    expect(tr.state.doc.toString()).toBe("1. a\n2. c\n3. d");
    // one undo step: the renumber rode inside the user's transaction
    expect(tr.changes.length).toBeGreaterThan(0);
  });

  test("indenting an item under its predecessor makes it a nested 1.", () => {
    const doc = "1. a\n2. b\n3. c";
    const s = stateOf(doc);
    const tr = s.update({ changes: { from: doc.indexOf("2. b"), insert: "  " }, userEvent: "input.indent" });
    expect(tr.state.doc.toString()).toBe("1. a\n  1. b\n2. c");
  });

  test("the caret survives a renumber on its own line", () => {
    const doc = "1. a\n1. bee";
    const s = stateOf(doc);
    const caret = doc.length;
    const tr = s.update({
      changes: { from: caret, insert: "s" },
      selection: EditorSelection.cursor(caret + 1),
      userEvent: "input.type",
    });
    expect(tr.state.doc.toString()).toBe("1. a\n2. bees");
    expect(tr.state.selection.main.head).toBe(tr.state.doc.length);
  });

  test("undo, redo, and programmatic replacements pass through untouched", () => {
    const s = stateOf("1. a\n1. b");
    expect(s.update({ changes: { from: 0, insert: "" }, userEvent: "undo" }).state.doc.toString()).toBe(
      "1. a\n1. b",
    );
    expect(s.update({ changes: { from: s.doc.length, insert: "!" } }).state.doc.toString()).toBe(
      "1. a\n1. b!",
    );
  });
});

describe("lettered runs", () => {
  test("letters renumber a→b→c in their own case, keeping a later start", () => {
    expect(renumber("a. x\na. y\nd. z")).toBe("a. x\nb. y\nc. z");
    expect(renumber("C. x\nC. y")).toBe("C. x\nD. y");
  });
  test("runs never mix styles: a number after a letter starts its own run", () => {
    expect(renumber("a. x\nb. y\n3. z\n3. w")).toBe("a. x\nb. y\n3. z\n4. w");
    expect(renumber("1. x\n1. y\na. z\nc. w")).toBe("1. x\n2. y\na. z\nb. w");
    expect(renumber("a. x\nA. y\nA. z")).toBe("a. x\nA. y\nB. z");
  });
  test("a nested lettered run starts at a", () => {
    expect(renumber("1. top\n  c. one\n  c. two\n2. next")).toBe("1. top\n  a. one\n  b. two\n2. next");
  });
  test("renumbering stops past z", () => {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const doc = [...letters.map((l) => `${l}. item`), "a. extra"].join("\n");
    expect(renumber(doc)).toBe(doc);
  });
});

describe("widestOrdinalInRun — one number column per run", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `${i + 1}. item`);

  test("every item of a run that reaches ten reports two characters, from any line", () => {
    const doc = Text.of(twelve);
    expect(widestOrdinalInRun(doc, 1)).toBe(2);
    expect(widestOrdinalInRun(doc, 9)).toBe(2);
    expect(widestOrdinalInRun(doc, 12)).toBe(2);
  });

  test("a run that stays under ten keeps one; prose ends a run; nested runs are their own", () => {
    const doc = Text.of(["1. a", "2. b", "", "prose", ...twelve, "   1. nested", "   2. nested"]);
    expect(widestOrdinalInRun(doc, 1)).toBe(1);
    expect(widestOrdinalInRun(doc, 5)).toBe(2);
    expect(widestOrdinalInRun(doc, 17)).toBe(1);
    expect(widestOrdinalInRun(doc, 4)).toBe(0);
  });

  test("deeper items ride along without ending the outer run", () => {
    const doc = Text.of(["8. a", "   - child", "9. b", "10. c"]);
    expect(widestOrdinalInRun(doc, 1)).toBe(2);
  });
});
