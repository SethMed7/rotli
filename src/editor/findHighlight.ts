// Paints "Find in this file" matches (2026-09-26) and the Librarian's passage
// into the document. The find
// bar moves the editor's selection to the current match, but a selection only
// paints while the editor has focus — and focus stays in the find box — so the
// matches are drawn as marks instead: every match, and the current one more
// strongly. Paint only: the text never changes. Positions map through edits;
// cmEditor re-sends the list after each edit so it stays exact.

import { type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import type { TextMatch } from "./find";

export interface FindMarks {
  matches: readonly TextMatch[];
  /** Index into `matches`, or -1 when no match is current. */
  current: number;
}

export const setFindMarks = StateEffect.define<FindMarks>();

const matchMark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-match cm-find-current" });

function build(marks: FindMarks, docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  marks.matches.forEach((match, index) => {
    if (match.from >= match.to || match.to > docLength) return;
    ranges.push((index === marks.current ? currentMark : matchMark).range(match.from, match.to));
  });
  return Decoration.set(ranges, true);
}

export const findHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindMarks)) next = build(effect.value, tr.newDoc.length);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// The Librarian's passage (2026-09-28): the same problem as Find — focus sits
// in the Librarian's box, so the highlighted passage would stop painting the
// moment the person starts typing. It is drawn as a mark while the Librarian
// is open, and follows edits like the find marks do.
export const setPassageMark = StateEffect.define<{ from: number; to: number } | null>();

const passageMark = Decoration.mark({ class: "cm-librarian-passage" });

export const passageHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setPassageMark)) continue;
      const range = effect.value;
      const valid = range && range.from < range.to && range.to <= tr.newDoc.length;
      next = valid ? Decoration.set([passageMark.range(range.from, range.to)]) : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
