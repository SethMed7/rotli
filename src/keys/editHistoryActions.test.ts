import { expect, test } from "bun:test";

import { isPlainTextField } from "./editHistoryActions";

test("a plain text field keeps the browser's undo; everything else is an editor's or nothing's", () => {
  expect(isPlainTextField({ tagName: "TEXTAREA" })).toBe(true);
  expect(isPlainTextField({ tagName: "INPUT", type: "text" })).toBe(true);
  expect(isPlainTextField({ tagName: "input", type: "" })).toBe(true);
  expect(isPlainTextField({ tagName: "INPUT", type: "search" })).toBe(true);
  // a checkbox, a button, the board's canvas, or nothing focused: no browser undo
  expect(isPlainTextField({ tagName: "INPUT", type: "checkbox" })).toBe(false);
  expect(isPlainTextField({ tagName: "BUTTON" })).toBe(false);
  // a contenteditable is an editor's (a note's CodeMirror, a sheet's Univer):
  // its own history answers ⌘Z
  expect(isPlainTextField({ tagName: "DIV" })).toBe(false);
  expect(isPlainTextField(null)).toBe(false);
});
