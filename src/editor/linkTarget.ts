// What an editor link click lands on, and the "couldn't open" state it leaves
// when the address opens nothing. CodeMirror-state only (no view, no DOM), so
// it unit-tests headless; linkOpener.ts wires the click and the tooltip.

import { type EditorState, StateEffect, StateField } from "@codemirror/state";

import { AUTOLINK_SOURCE, linkMatchAt, MD_LINK_SOURCE } from "./inlineLinks";

/** The web address under column `col`: an `[text](url)` link's url (the md
 * link wins, as it does in the render scan), else a bare autolink. */
export function webLinkAt(lineText: string, col: number): string | null {
  const md = linkMatchAt(MD_LINK_SOURCE, lineText, col);
  if (md) return md[2] ?? "";
  return linkMatchAt(AUTOLINK_SOURCE, lineText, col)?.[0] ?? null;
}

const showLinkFailure = StateEffect.define<number | null>();

/** Where the "couldn't open" note sits, or null. Any edit or caret move
 * clears it; a later failure moves it. */
export const linkFailureField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(showLinkFailure)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/** The effect that shows (or, with null, clears) the note at `pos`. */
export function linkFailureAt(pos: number | null) {
  return showLinkFailure.of(pos);
}

export function linkFailurePos(state: EditorState): number | null {
  return state.field(linkFailureField, false) ?? null;
}
