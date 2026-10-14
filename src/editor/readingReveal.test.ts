import { expect, test } from "bun:test";

import { EditorState } from "@codemirror/state";

import { readingView, revealRange } from "./readingReveal";

test("while reading, no line reveals its Markdown around the caret", () => {
  const doc = "# Title\n\nSome **bold** text.";
  const editing = EditorState.create({ doc, selection: { anchor: 12 } });
  expect(revealRange(editing)).toMatchObject({ from: 12, to: 12 });

  const reading = EditorState.create({ doc, selection: { anchor: 12 }, extensions: readingView.of(true) });
  // a range that touches nothing: every `sel.from <= end && sel.to >= start` test fails
  const range = revealRange(reading);
  expect(range.empty).toBe(true);
  expect(range.from <= doc.length && range.to >= 0).toBe(false);
});
