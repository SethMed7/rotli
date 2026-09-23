// memex-native [[wikilinks]] — format for insert, parse for ⌘-click resolve.
// Title is the default label; when titles collide, write the note's wire id.

import type { NoteSummary } from "../types";

export const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export interface WikilinkIndex {
  byId: Map<string, NoteSummary>;
  byTitle: Map<string, NoteSummary[]>;
  byAlias: Map<string, NoteSummary[]>;
}

const linkKey = (value: string): string => value.trim().toLocaleLowerCase();

function indexLabel(map: Map<string, NoteSummary[]>, label: string, note: NoteSummary): void {
  const key = linkKey(label);
  if (!key) return;
  const notes = map.get(key) ?? [];
  if (!notes.some((candidate) => candidate.id === note.id)) notes.push(note);
  map.set(key, notes);
}

export function buildWikilinkIndex(notes: readonly NoteSummary[]): WikilinkIndex {
  const byId = new Map<string, NoteSummary>();
  const byTitle = new Map<string, NoteSummary[]>();
  const byAlias = new Map<string, NoteSummary[]>();
  for (const n of notes) {
    byId.set(n.id, n);
    indexLabel(byTitle, n.title, n);
    for (const alias of n.aliases ?? []) indexLabel(byAlias, alias, n);
  }
  return { byId, byTitle, byAlias };
}

/** How many notes share each trimmed title — drives id-vs-title insert choice. */
export function buildTitleCounts(notes: readonly NoteSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const t = linkKey(n.title);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** What to write inside [[…]] — title unless duplicated, then the wire id. */
export function wikilinkLabel(note: NoteSummary, titleCounts: Map<string, number>): string {
  const count = titleCounts.get(linkKey(note.title)) ?? 1;
  return count > 1 ? note.id : note.title;
}

/** The NAVIGATION target inside [[…]] — strips the Obsidian-style display
 * alias (`[[target|shown]]`), heading fragment (`[[target#h2]]`), and a
 * trailing `.md`, which all read as "link broken" when treated literally. */
export function wikilinkTargetOf(inner: string): string {
  let t = (inner.split("|")[0] ?? "").split("#")[0] ?? "";
  t = t.trim();
  if (t.toLowerCase().endsWith(".md")) t = t.slice(0, -3);
  return t;
}

/** Resolve [[target]] to a note id, or null when missing / ambiguous. */
export function resolveWikilink(target: string, index: WikilinkIndex): string | null {
  const t = wikilinkTargetOf(target);
  if (!t) return null;
  if (index.byId.has(t)) return t;
  // a note with no frontmatter id is identified by its path, `.md` included —
  // the id the picker writes when titles collide. Only a link written with
  // the `.md`, or as a path, means that id: a bare [[Plan]] must not open
  // whichever note is stored as Plan.md over the note titled "Plan".
  const written = ((target.split("|")[0] ?? "").split("#")[0] ?? "").trim();
  const pathId = `${t}.md`;
  if ((written.toLowerCase().endsWith(".md") || t.includes("/")) && index.byId.has(pathId)) return pathId;
  const lookup = (value: string): string | null => {
    const key = linkKey(value);
    const candidates = [...(index.byTitle.get(key) ?? []), ...(index.byAlias.get(key) ?? [])].filter(
      (note, position, notes) => notes.findIndex((candidate) => candidate.id === note.id) === position,
    );
    return candidates.length === 1 ? candidates[0]!.id : null;
  };
  const direct = lookup(t);
  if (direct) return direct;
  // a path-style target ([[projects/Note]]) still names ONE note — try its
  // last segment before giving up
  const last = t.includes("/") ? t.slice(t.lastIndexOf("/") + 1) : null;
  return last ? lookup(last) : null;
}

/** Local note navigation is link-like; web navigation remains deliberate in an editor. */
export function editorLinkOpensOnClick(kind: "note" | "web", button: number, metaKey: boolean): boolean {
  return button === 0 && (kind === "note" || metaKey);
}
