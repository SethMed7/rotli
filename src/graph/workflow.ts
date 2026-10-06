// What the Graph view shows: the whole vault, or the notes around one note
// (the local graph). One surface, two scopes — never a second panel.

import { type Graph, neighborhood, writtenOnly } from "./model";

export type GraphScope = { kind: "all" } | { kind: "around"; noteId: string; depth: 1 | 2 };

export const ALL_NOTES_SCOPE: GraphScope = { kind: "all" };

/** What the view draws: the Librarian's links only while they're switched
 * on (so a local graph reaches through them only then), then the scope. */
export function scopedGraph(graph: Graph, scope: GraphScope, librarianLinks = true): Graph {
  const base = librarianLinks ? graph : writtenOnly(graph);
  return scope.kind === "all" ? base : neighborhood(base, scope.noteId, scope.depth);
}

/** The scope's center, emphasized and always labeled. */
export function scopeCenter(scope: GraphScope): string | null {
  return scope.kind === "around" ? scope.noteId : null;
}
