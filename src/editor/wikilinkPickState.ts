// Where a `[[wikilink` is being typed, and which notes to offer for it. Pure.

import type { NoteSummary } from "../types";

export interface WikilinkPickSpan {
  /** Column of the opening `[[`. */
  open: number;
  /** Column of the caret; the typed target is `[open + 2, to)`. */
  to: number;
  query: string;
}

/** The caret sits after `[[` plus some text with no `]` since; backticked
 * spans are opaque, and a link that is already closed stays closed. */
export function wikilinkPickAt(line: string, caret: number): WikilinkPickSpan | null {
  const before = line.slice(0, caret);
  const match = /\[\[([^[\]]*)$/.exec(before);
  if (!match) return null;
  if ((before.match(/`/g) ?? []).length % 2 === 1) return null;
  if (line.slice(caret).startsWith("]")) return null;
  const open = caret - match[0].length;
  return { open, to: caret, query: match[1] ?? "" };
}

const key = (value: string) => value.trim().toLowerCase();

/** Titles (then aliases) that start with the typed text rank first, then any
 * that contain it; an empty query offers the most recently updated notes. */
export function wikilinkChoices(notes: readonly NoteSummary[], query: string, limit = 8): NoteSummary[] {
  const q = key(query);
  const rank = (note: NoteSummary): number => {
    const title = key(note.title);
    if (q === "") return 0;
    if (title.startsWith(q)) return 0;
    if ((note.aliases ?? []).some((alias) => key(alias).startsWith(q))) return 1;
    if (title.includes(q)) return 2;
    if ((note.aliases ?? []).some((alias) => key(alias).includes(q))) return 3;
    return -1;
  };
  return notes
    .filter((note) => note.kind !== "file" && note.kind !== "board")
    .map((note) => ({ note, rank: rank(note) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.note.updatedAt - a.note.updatedAt)
    .slice(0, limit)
    .map((entry) => entry.note);
}
