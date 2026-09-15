// Where a `[[wikilink` is being typed, and which notes to offer for it. Pure.

import type { NoteSummary } from "../types";

export interface WikilinkPickSpan {
  /** Column of the opening `[[`. */
  open: number;
  /** End column of the pick: the caret, or past an auto-closed `]]`. The typed
   * target is `[open + 2, caret)`. */
  to: number;
  query: string;
  /** True when the link is already closed by a `]]` right after the caret —
   * the picker offers it only while typing, never when the caret just arrives. */
  closed?: boolean;
}

/** The caret sits after `[[` plus some text with no `]` since; backticked
 * spans are opaque. A `]]` right after the caret (auto-pairing writes it)
 * belongs to the pick, so choosing replaces through it; any other `]` there
 * means the link is not being typed. */
export function wikilinkPickAt(line: string, caret: number): WikilinkPickSpan | null {
  const before = line.slice(0, caret);
  const match = /\[\[([^[\]]*)$/.exec(before);
  if (!match) return null;
  if ((before.match(/`/g) ?? []).length % 2 === 1) return null;
  const open = caret - match[0].length;
  const query = match[1] ?? "";
  if (line.startsWith("]]", caret)) return { open, to: caret + 2, query, closed: true };
  if (line.slice(caret).startsWith("]")) return null;
  return { open, to: caret, query };
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
