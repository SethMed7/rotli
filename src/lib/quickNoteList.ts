// What the Quick Note window lists and calls the open note — pure, so it is
// testable without the editor (CodeMirror needs a DOM).

import type { NoteSummary, SearchHit } from "../types";
import { foldText, subsequenceMatch } from "./fuzzy";

/** A blank note has nothing to browse or switch to: the one you are typing
 * into is already open, and ⌘N reuses it (the maintainer, 2026-09-23:
 * "Untitled should not be showing"). Pure for tests. */
export function pickableNotes(notes: NoteSummary[]): NoteSummary[] {
  return notes.filter((n) => n.bodyEmpty !== true);
}

/** The header names the open note; a blank one is a new note, not "Untitled". */
export function quickNoteTitle(note: NoteSummary | undefined): string {
  return note && note.bodyEmpty !== true && note.title ? note.title : "New note";
}

/** How strongly a title answers the query, lower first; null = no match.
 * 0 prefix · 1 a word starts with it · 2 substring · 3 every word somewhere ·
 * 4 a forgiving subsequence. Case- and diacritic-folded both sides. */
export function titleMatchTier(query: string, title: string): number | null {
  const q = foldText(query.trim());
  if (!q) return null;
  const t = foldText(title);
  if (t.startsWith(q)) return 0;
  const at = t.indexOf(q);
  if (at > 0 && /[^\p{L}\p{N}]/u.test(t[at - 1] ?? "")) return 1;
  if (at >= 0) return 2;
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 3;
  return subsequenceMatch(q, t) ? 4 : null;
}

export const PICKER_LIMIT = 60;

export interface PickerInput {
  /** Every Markdown note the picker may open, blank ones included. */
  notes: readonly NoteSummary[];
  query: string;
  pinned: ReadonlySet<string>;
  /** Full-text hits for THIS query, or undefined while none have settled. */
  hits: readonly SearchHit[] | undefined;
}

/** The ⌘P rows. Empty query: written notes, pinned first. Typed: instant title
 * matches by tier (pinned breaks ties), then what only the full-text engine
 * found, in its order — a title match never sits beneath a body-only one.
 * Blank notes are findable by name but never by a stray subsequence, so a
 * pile of "Untitled" blanks cannot flood a two-letter query. Hits outside
 * `notes` (boards, files, Archive) are not openable here and are dropped. */
export function pickerResults({ notes, query, pinned, hits }: PickerInput): NoteSummary[] {
  if (!query.trim()) {
    const written = pickableNotes([...notes]);
    const fav = written.filter((n) => pinned.has(n.id));
    const rest = written.filter((n) => !pinned.has(n.id));
    return [...fav, ...rest].slice(0, PICKER_LIMIT);
  }
  const titled = notes
    .map((note, order) => ({ note, order, tier: titleMatchTier(query, note.title) }))
    .filter(
      (row): row is { note: NoteSummary; order: number; tier: number } =>
        row.tier !== null && (row.note.bodyEmpty !== true || row.tier < 4),
    )
    .sort(
      (a, b) =>
        a.tier - b.tier || Number(pinned.has(b.note.id)) - Number(pinned.has(a.note.id)) || a.order - b.order,
    )
    .map((row) => row.note);
  const seen = new Set(titled.map((n) => n.id));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const bodyOnly: NoteSummary[] = [];
  for (const hit of hits ?? []) {
    const note = byId.get(hit.id);
    if (!note || seen.has(hit.id)) continue;
    seen.add(hit.id);
    bodyOnly.push(note);
  }
  return [...titled, ...bodyOnly].slice(0, PICKER_LIMIT);
}

export const PICKER_STATUS = {
  loading: "Still loading notes…",
  searching: "Searching note text…",
  failed: "Couldn’t search note text — showing title matches",
  noMatch: "No notes match.",
  noNotes: "No notes yet.",
} as const;

/** The line under the picker's rows. Rows already on screen stay; the line
 * says whether the list is the whole answer yet. */
export function pickerStatus(input: {
  query: string;
  rows: number;
  notesReady: boolean;
  search: "idle" | "pending" | "settled" | "failed";
}): string | null {
  if (!input.notesReady) return PICKER_STATUS.loading;
  if (input.search === "pending") return PICKER_STATUS.searching;
  if (input.search === "failed") return PICKER_STATUS.failed;
  if (input.rows > 0) return null;
  return input.query.trim() ? PICKER_STATUS.noMatch : PICKER_STATUS.noNotes;
}
