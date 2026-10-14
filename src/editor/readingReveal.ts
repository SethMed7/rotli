// Reading mode's reveal rule (editor/readingMode.ts), kept free of the DOM so it
// is testable on its own: while reading, no line counts as touched by the
// caret, so the beautified view never shows Markdown. Read by every
// reveal-on-caret decorator (livePreview, blockRender, tableRender).

import { type EditorState, Facet, type SelectionRange } from "@codemirror/state";

export const readingView = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

type Reveal = Pick<SelectionRange, "from" | "to" | "empty">;
const NO_REVEAL: Reveal = { from: -1, to: -1, empty: true };

/** The range the beautified view reveals Markdown around: the selection, or
 * nothing at all while reading. */
export function revealRange(state: EditorState): Reveal {
  return state.facet(readingView) ? NO_REVEAL : state.selection.main;
}
