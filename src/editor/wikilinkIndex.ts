// Imperative wikilink index for CodeMirror plugins (no React in livePreview).

import type { NoteSummary } from "../types";
import { type WikilinkIndex, buildWikilinkIndex, resolveWikilink } from "./wikilink";

let index: WikilinkIndex = buildWikilinkIndex([]);
let current: readonly NoteSummary[] = [];

let fingerprint = "";

/** Replace what links resolve to. Answers whether anything a link READS (id,
 * title, aliases) actually changed — callers re-decorate only then. */
export function setWikilinkNotes(notes: readonly NoteSummary[]): boolean {
  const next = notes.map((n) => `${n.id}\0${n.title}\0${(n.aliases ?? []).join("\x01")}`).join("\n");
  current = notes;
  if (next === fingerprint) return false;
  fingerprint = next;
  index = buildWikilinkIndex(notes);
  return true;
}

/** The notes a `[[` picker may offer: the same list the resolver reads. */
export function wikilinkNotes(): readonly NoteSummary[] {
  return current;
}

export function resolveWikilinkTarget(target: string): string | null {
  return resolveWikilink(target, index);
}

/** The item a link points at, for an opener that treats kinds differently (a
 * chat opens as a conversation, not as its transcript file). */
export function resolveWikilinkNote(target: string): NoteSummary | null {
  const id = resolveWikilink(target, index);
  return id ? (current.find((note) => note.id === id) ?? null) : null;
}
