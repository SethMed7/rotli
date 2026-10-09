// ⌘Z / ⇧⌘Z everywhere (the owner, 2026-10-09: "we need the hotkeys for undo
// and redo to work — everywhere I try"). The Mac's Edit menu no longer takes
// those keys (src-tauri lib.rs swaps its Undo/Redo for key-less look-alikes),
// so the real press reaches the page. An editor with its own history — a
// note's CodeMirror, a sheet's or document's Univer, a board's Excalidraw —
// answers it first and marks it handled, and the dispatcher stands down. What
// is left is a plain text field (a title, the chat composer, a rename box),
// whose history lives in WebKit: these actions ask WebKit to undo there, as
// the menu's undo: used to. They claim ⌘Z ONLY while such a field has focus
// (`enabled`): an editor's keymap yields any chord a registry action claims
// (editor/vendorKeymap.ts), so an always-on claim took ⌘Z from a note's own
// history. Registered from ./actions.ts.

import { registerAction } from "./registry";

/** The part of an element this rule reads (a DOM Element in the app). */
interface FieldLike {
  tagName: string;
  type?: string;
}

const TEXT_INPUTS = new Set(["", "text", "search", "url", "email", "tel", "password", "number"]);

/** A text field whose undo history is the browser's own: a textarea or a text
 * input. A contenteditable is never one — in Rotli each belongs to an editor
 * with its own history (CodeMirror, Univer), and a board's text box is a
 * textarea under the canvas, which keeps ⌘Z (registry CANVAS_OWNED_CHORDS). */
export function isPlainTextField(element: FieldLike | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && TEXT_INPUTS.has((element.type ?? "").toLowerCase());
}

const plainFieldFocused = () =>
  typeof document !== "undefined" && isPlainTextField(document.activeElement as FieldLike | null);

function browserHistory(command: "undo" | "redo"): void {
  if (!plainFieldFocused()) return;
  // oxlint-disable-next-line typescript/no-deprecated -- the only way to reach a text field's own undo history; WebKit and Chromium still run it, and nothing replaces it
  document.execCommand(command);
}

export function registerEditHistoryActions(): void {
  registerAction({
    id: "edit.undo",
    title: "Undo",
    defaultChord: "Meta+Z",
    shared: true,
    enabled: plainFieldFocused,
    keywords: ["undo", "take back"],
    run: () => browserHistory("undo"),
  });
  registerAction({
    id: "edit.redo",
    title: "Redo",
    defaultChord: "Meta+Shift+Z",
    shared: true,
    enabled: plainFieldFocused,
    keywords: ["redo"],
    run: () => browserHistory("redo"),
  });
}

/** Edit → Undo / Redo picked with the pointer. A plain text field (board text
 * included — its textarea sits under the canvas, which owns the ⌘Z chord)
 * gets the browser's own undo directly: a replayed key press is untrusted and
 * never triggers it. Anything else hears the press replayed, so the editor
 * there (a note, a sheet, a document, a board) answers it exactly as it
 * answers ⌘Z. */
export function replayHistoryKey(redo: boolean): void {
  if (plainFieldFocused()) {
    browserHistory(redo ? "redo" : "undo");
    return;
  }
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(historyKeyEvent(redo));
}

/** The platform's undo / redo press as a keydown: ⌘Z / ⇧⌘Z on the Mac,
 * Ctrl+Z / ⇧Ctrl+Z elsewhere (lib/historyChords). Univer matches shortcuts on
 * the legacy keyCode, which a constructed KeyboardEvent leaves at 0, so it is
 * set here. */
export function historyKeyEvent(redo: boolean): KeyboardEvent {
  const mac = /Mac/.test(navigator.platform || navigator.userAgent);
  const event = new KeyboardEvent("keydown", {
    key: redo ? "Z" : "z",
    code: "KeyZ",
    metaKey: mac,
    ctrlKey: !mac,
    shiftKey: redo,
    bubbles: true,
    cancelable: true,
  });
  for (const legacy of ["keyCode", "which"]) Object.defineProperty(event, legacy, { get: () => 90 });
  return event;
}
