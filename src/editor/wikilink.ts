// memex-native [[wikilinks]] — format for insert, parse for ⌘-click resolve.
// Title is the default label; when titles collide, write the note's wire id.

import type { NoteSummary } from "../types";

export const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export interface WikilinkIndex {
  byId: Map<string, NoteSummary>;
  byTitle: Map<string, NoteSummary[]>;
}

export function buildWikilinkIndex(notes: readonly NoteSummary[]): WikilinkIndex {
  const byId = new Map<string, NoteSummary>();
  const byTitle = new Map<string, NoteSummary[]>();
  for (const n of notes) {
    byId.set(n.id, n);
    const title = n.title.trim();
    const arr = byTitle.get(title) ?? [];
    arr.push(n);
    byTitle.set(title, arr);
  }
  return { byId, byTitle };
}

/** How many notes share each trimmed title — drives id-vs-title insert choice. */
export function buildTitleCounts(notes: readonly NoteSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const t = n.title.trim();
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** What to write inside [[…]] — title unless duplicated, then the wire id. */
export function wikilinkLabel(note: NoteSummary, titleCounts: Map<string, number>): string {
  const count = titleCounts.get(note.title.trim()) ?? 1;
  return count > 1 ? note.id : note.title;
}

/** Resolve [[target]] to a note id, or null when missing / ambiguous. */
export function resolveWikilink(target: string, index: WikilinkIndex): string | null {
  const t = target.trim();
  if (!t) return null;
  if (index.byId.has(t)) return t;
  const hits = index.byTitle.get(t);
  if (hits?.length === 1) return hits[0]!.id;
  return null;
}

/** Local note navigation is link-like; web navigation remains deliberate in an editor. */
export function editorLinkOpensOnClick(kind: "note" | "web", button: number, metaKey: boolean): boolean {
  return button === 0 && (kind === "note" || metaKey);
}
