// Reading mode (the owner, 2026-10-14): the note only to read. The editor
// takes no input, and the beautified view never reveals Markdown around the
// caret, because there is no caret (the rule: readingReveal.ts).

import { type Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { readingView } from "./readingReveal";

/** What the editor's reading compartment holds while reading. */
export const READING: Extension = [
  readingView.of(true),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

/** Turn reading on or off in a view. Re-selecting rebuilds the reveal-on-caret
 * decorations under the new facet, and the caret leaves while reading. */
export function setReading(view: EditorView, slot: Compartment, on: boolean): void {
  view.dispatch({ effects: slot.reconfigure(on ? READING : []), selection: view.state.selection });
  if (on) view.contentDOM.blur();
}
