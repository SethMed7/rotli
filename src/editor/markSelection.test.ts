// A reader's report (2026-09-28): selecting a line and bolding it left the
// line plain and put `****` in front of the next line's `- `, breaking the
// bullet. The command now marks each selected line's own text.

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { markSelectionSpec } from "./markSelection";

const NOTE = "Budgets & Purchasing Process\n- $50 to $100\n- need proof of results";

function bold(doc: string, anchor: number, head = anchor) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  const spec = markSelectionSpec(state, "bold");
  if (!spec) return { doc, selected: null };
  const next = state.update(spec).state;
  const { from, to } = next.selection.main;
  return { doc: next.doc.toString(), selected: next.sliceDoc(from, to) };
}

describe("bold over a selection", () => {
  test("a whole line picked up to the next line's start bolds that line only", () => {
    const end = NOTE.indexOf("- $50"); // the selection ends at column 0 of line 2
    expect(bold(NOTE, 0, end)).toEqual({
      doc: "**Budgets & Purchasing Process**\n- $50 to $100\n- need proof of results",
      selected: "Budgets & Purchasing Process",
    });
  });

  test("several lines: each line's text is bolded and every bullet survives", () => {
    const result = bold(NOTE, 0, NOTE.length);
    expect(result.doc).toBe(
      "**Budgets & Purchasing Process**\n- **$50 to $100**\n- **need proof of results**",
    );
    // the selection still runs from the first word to the last
    expect(result.selected?.startsWith("Budgets")).toBe(true);
    expect(result.selected?.endsWith("results")).toBe(true);
    // and pressing it again takes the bold off every line
    expect(bold(result.doc, 0, result.doc.length).doc).toBe(NOTE);
  });

  test("a mixed selection bolds the lines that aren't bold yet", () => {
    const doc = "**One**\n- two";
    expect(bold(doc, 0, doc.length).doc).toBe("**One**\n- **two**");
  });

  test("a selection that starts inside a marker or a heading bolds only the text", () => {
    expect(bold("- $50 to $100", 0, 13).doc).toBe("- **$50 to $100**");
    expect(bold("## Budgets", 0, 10).doc).toBe("## **Budgets**");
    expect(bold("  - [ ] call Sam", 0, 16).doc).toBe("  - [ ] **call Sam**");
  });

  test("a selection across two lines' middles bolds each part", () => {
    const doc = "alpha beta\ngamma delta";
    expect(bold(doc, 6, 16).doc).toBe("alpha **beta**\n**gamma** delta");
  });

  test("markers and blank space alone change nothing", () => {
    expect(bold("- \n\n- ", 0, 6)).toEqual({ doc: "- \n\n- ", selected: null });
  });

  test("a caret still opens an empty pair to type into, as before", () => {
    expect(bold("write ", 6)).toEqual({ doc: "write ****", selected: "" });
  });
});
