// Where a `:color` suffix is being typed inside a result or toggle bracket.
// Pure: the tooltip and keymap in colorPicker.ts turn this into UI.

import { RESULT_COLOR_NAMES, type ResultColorName } from "./resultColors";

export interface ColorPickSpan {
  /** Document-relative column where the typed color name starts (after `:`). */
  from: number;
  /** Column of the caret; the typed name is `[from, to)`. */
  to: number;
  query: string;
}

/** The caret sits right after `:` (plus letters) inside a control bracket:
 * a `[` with no `]` since, opened at a list marker or at the start of a line
 * (the first box is typed before Space expands the row), right after another
 * box (`][`), or on the far side of a toggle's `|`. Backticked spans are opaque. */
export function colorPickAt(line: string, caret: number): ColorPickSpan | null {
  const before = line.slice(0, caret);
  const match = /:([a-zA-Z]*)$/.exec(before);
  if (!match || /^[a-zA-Z]/.test(line.slice(caret))) return null;
  const colon = caret - match[0].length;
  const opener = before.lastIndexOf("[", colon);
  if (opener < 0 || before.slice(opener, colon).includes("]")) return null;
  const inner = before.slice(opener + 1, colon);
  if (inner.includes("[")) return null;
  const lead = before.slice(0, opener);
  const control = /(?:^\s*(?:-|\d+\.) |\])$|^\s*$/.test(lead) || inner.includes("|");
  if (!control) return null;
  if ((before.match(/`/g) ?? []).length % 2 === 1) return null;
  return { from: colon + 1, to: caret, query: match[1] ?? "" };
}

/** Names that start with the typed letters, rainbow order kept. */
export function colorChoices(query: string): ResultColorName[] {
  const q = query.toLowerCase();
  return RESULT_COLOR_NAMES.filter((name) => name.startsWith(q));
}

/** The number key that picks a choice: 1–9 for the first nine, 0 for the tenth. */
export function colorHotkey(index: number): string | null {
  if (index < 9) return String(index + 1);
  return index === 9 ? "0" : null;
}
