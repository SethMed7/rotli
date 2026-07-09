// Imperative wikilink index for CodeMirror plugins (no React in livePreview).

import type { NoteSummary } from "../types";
import { type WikilinkIndex, buildWikilinkIndex, resolveWikilink } from "./wikilink";

let index: WikilinkIndex = buildWikilinkIndex([]);

export function setWikilinkNotes(notes: readonly NoteSummary[]): void {
  index = buildWikilinkIndex(notes);
}

export function resolveWikilinkTarget(target: string): string | null {
  return resolveWikilink(target, index);
}
