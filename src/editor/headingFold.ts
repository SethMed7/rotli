// Heading folding (Seth, 2026-08-04, from ZenNotes): collapse a section down to
// its heading so a long note reads as an outline.
//
// This file is the CodeMirror wiring only — the range math lives in
// foldRanges.ts, free of CM so it can be tested without a DOM. Hiding is done by
// CM's own fold state, which means the caret, selection, search and undo all
// keep behaving exactly as they always have.

import { codeFolding, foldEffect, foldService, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { type FoldLine, foldLines, headingFoldRange } from "./foldRanges";

/** Read the document once into the pure shape the math wants. */
function linesOf(state: EditorState): FoldLine[] {
  const texts: string[] = [];
  const offsets: number[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    texts.push(line.text);
    offsets.push(line.from);
  }
  return foldLines(texts, offsets);
}

/**
 * Fold or unfold the section the caret sits in. Works from ANYWHERE inside a
 * section, not only on its title — searching upward for the owning heading is
 * what makes ⌥⌘K usable while you're reading the body.
 */
export function toggleHeadingFold(view: EditorView): boolean {
  const state = view.state;
  const lineNo = state.doc.lineAt(state.selection.main.head).number;
  const lines = linesOf(state);
  let index = lineNo - 1;
  while (index >= 0 && (lines[index]?.level ?? 0) === 0) index--;
  if (index < 0) return false;
  const range = headingFoldRange(lines, index);
  if (!range) return false;

  // already folded at this exact boundary? then this press is an UNFOLD
  let folded = false;
  foldedRanges(state).between(range.from, range.from, () => {
    folded = true;
    return false;
  });
  view.dispatch({ effects: (folded ? unfoldEffect : foldEffect).of(range) });
  return true;
}

/** Folding + the heading-aware range service. */
export function headingFolding(): Extension {
  return [
    codeFolding({
      placeholderDOM: (_view, onclick) => {
        const el = document.createElement("span");
        el.className = "rotli-fold-ph";
        el.textContent = "⋯";
        el.title = "Show this section";
        el.setAttribute("aria-label", "Show this section");
        el.onclick = onclick;
        return el;
      },
    }),
    foldService.of((state, lineStart) => {
      const lines = linesOf(state);
      return headingFoldRange(lines, state.doc.lineAt(lineStart).number - 1);
    }),
  ];
}
