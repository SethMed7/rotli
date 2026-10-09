import { afterAll, expect, test } from "bun:test";

import { isRedoChord, isUndoChord } from "../lib/historyChords";
import { normalizeChord } from "./chords";
import { isPlainTextField, registerEditHistoryActions } from "./editHistoryActions";
import { claimingAction } from "./registry";

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

// CodeMirror yields any chord a registry action claims (editor/vendorKeymap.ts
// asks claimingAction), so ⌘Z must be unclaimed unless a plain field has focus
const g = globalThis as unknown as { document?: unknown };
const savedDocument = g.document;
afterAll(() => {
  g.document = savedDocument;
});

test("⌘Z and ⇧⌘Z are claimed only while a plain text field has focus, so a note keeps its own undo", () => {
  registerEditHistoryActions();
  const undo = normalizeChord("Meta+Z");
  const redo = normalizeChord("Meta+Shift+Z");
  g.document = { activeElement: { tagName: "DIV" } }; // a note's CodeMirror
  expect(claimingAction(undo)).toBeNull();
  expect(claimingAction(redo)).toBeNull();
  g.document = { activeElement: { tagName: "TEXTAREA" } }; // the chat box
  expect(claimingAction(undo)?.id).toBe("edit.undo");
  expect(claimingAction(redo)?.id).toBe("edit.redo");
});

test("undo is ⌘Z and redo ⇧⌘Z on the Mac (Ctrl elsewhere); redo and ⇧Ctrl+Z elsewhere — never the other platform's chord", () => {
  const key = (mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }, code = "KeyZ") => ({
    code,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  });
  expect(isRedoChord(key({ meta: true, shift: true }), true)).toBe(true);
  expect(isRedoChord(key({ ctrl: true, shift: true }), true)).toBe(false);
  expect(isRedoChord(key({ meta: true }), true)).toBe(false); // ⌘Z is undo
  expect(isRedoChord(key({ meta: true, shift: true, alt: true }), true)).toBe(false);
  expect(isRedoChord(key({ meta: true, shift: true }, "KeyY"), true)).toBe(false);
  expect(isRedoChord(key({ ctrl: true, shift: true }), false)).toBe(true);
  expect(isUndoChord(key({ meta: true }), true)).toBe(true);
  expect(isUndoChord(key({ meta: true, shift: true }), true)).toBe(false);
  expect(isUndoChord(key({ ctrl: true }), true)).toBe(false);
  expect(isUndoChord(key({ ctrl: true }), false)).toBe(true);
  expect(isRedoChord(key({ meta: true, shift: true }), false)).toBe(false);
});
