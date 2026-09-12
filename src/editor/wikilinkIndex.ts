// Imperative wikilink index for CodeMirror plugins (no React in livePreview).

import type { NoteSummary } from "../types";
import { type WikilinkIndex, buildWikilinkIndex, resolveWikilink } from "./wikilink";

let index: WikilinkIndex = buildWikilinkIndex([]);
let current: readonly NoteSummary[] = [];

export function setWikilinkNotes(notes: readonly NoteSummary[]): void {
  current = notes;
  index = buildWikilinkIndex(notes);
}

/** The notes a `[[` picker may offer: the same list the resolver reads. */
export function wikilinkNotes(): readonly NoteSummary[] {
  return current;
}

export function resolveWikilinkTarget(target: string): string | null {
  return resolveWikilink(target, index);
}
