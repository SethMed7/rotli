// A reader's report (2026-09-28): selecting a line and bolding it left the
// line plain and put `****` in front of the next line's `- `, breaking the
// bullet. The command now marks each selected line's own text.

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { markSelectionSpec } from "./markSelection";

const NOTE = "Budgets & Purchasing Process\n- $50 to $100\n- need proof of results";

function press(state: EditorState): EditorState {
  const spec = markSelectionSpec(state, "bold");
  return spec ? state.update(spec).state : state;
}

function bold(doc: string, anchor: number, head = anchor) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  if (!markSelectionSpec(state, "bold")) return { doc, selected: null };
  const next = press(state);
  const { from, to } = next.selection.main;
  return { doc: next.doc.toString(), selected: next.sliceDoc(from, to), next };
}

/** Bold, then Bold again with the selection the first press left. */
function boldTwice(doc: string, anchor: number, head: number): string {
  return press(bold(doc, anchor, head).next!).doc.toString();
}

describe("bold over a selection", () => {
  test("a whole line picked up to the next line's start bolds that line only", () => {
    const end = NOTE.indexOf("- $50"); // the selection ends at column 0 of line 2
    expect(bold(NOTE, 0, end)).toMatchObject({
      doc: "**Budgets & Purchasing Process**\n- $50 to $100\n- need proof of results",
      selected: "Budgets & Purchasing Process",
    });
    expect(boldTwice(NOTE, 0, end)).toBe(NOTE); // and the second press takes it off
  });

  test("several lines: each line's text is bolded and every bullet survives", () => {
    const result = bold(NOTE, 0, NOTE.length);
    expect(result.doc).toBe(
      "**Budgets & Purchasing Process**\n- **$50 to $100**\n- **need proof of results**",
    );
    // the selection keeps every line, marks included
    expect(result.selected).toBe(result.doc);
    // so pressing it again, as it stands, takes the bold off every line
    expect(boldTwice(NOTE, 0, NOTE.length)).toBe(NOTE);
  });

  test("a mixed selection bolds the lines that aren't bold yet", () => {
    const doc = "**One**\n- two";
    expect(bold(doc, 0, doc.length).doc).toBe("**One**\n- **two**");
    // a line that is only partly bold counts as not bold: it becomes one span
    const partly = "**One** more\n- two";
    expect(bold(partly, 0, partly.length).doc).toBe("**One more**\n- **two**");
  });

  test("a selection that starts inside a marker or a heading bolds only the text", () => {
    expect(bold("- $50 to $100", 0, 13).doc).toBe("- **$50 to $100**");
    expect(bold("## Budgets", 0, 10).doc).toBe("## **Budgets**");
    expect(bold("  - [ ] call Sam", 0, 16).doc).toBe("  - [ ] **call Sam**");
  });

  test("a selection across two lines' middles bolds each part", () => {
    const doc = "alpha beta\ngamma delta";
    expect(bold(doc, 6, 16).doc).toBe("alpha **beta**\n**gamma** delta");
    expect(boldTwice(doc, 6, 16)).toBe(doc);
  });

  test("markers and blank space alone change nothing", () => {
    expect(bold("- \n\n- ", 0, 6)).toMatchObject({ doc: "- \n\n- ", selected: null });
  });

  test("a caret still opens an empty pair to type into, as before", () => {
    expect(bold("write ", 6)).toMatchObject({ doc: "write ****", selected: "" });
  });
});
