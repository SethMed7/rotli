// Wires the Graph view to the vault: the Links projection (Rust on the Mac,
// the TS twin on the web) resolved against the same linkable set the editor
// uses (useWikilinkIndex), so an edge here is a link that opens there.

import { useMemo } from "react";

import { DEST } from "../services/destinations";
import { useChatTranscripts, useNoteLinks, useNotes, useSearchableNotes } from "../services/hooks";
import { type Graph, buildGraph } from "./model";

/** The graph is drawn only once the projection AND the lists that name its
 * notes have loaded — never a frame of placeholder titles. */
export function graphInputsReady<T>(
  links: T | null | undefined,
  notesReady: boolean,
  archived: unknown,
): links is T {
  return links !== undefined && links !== null && notesReady && archived !== undefined;
}

/** The first failure among the Graph's inputs, as words, or null. The graph
 * waits for all of them (graphInputsReady), so a list that failed must be
 * reported, or the view would say Loading… forever. */
export function graphError(...failures: unknown[]): string | null {
  const failure = failures.find((cause) => cause !== null && cause !== undefined);
  if (failure === undefined) return null;
  if (failure instanceof Error) return failure.message;
  return typeof failure === "string" ? failure : "an unexpected error";
}

export function useVaultGraph(): { graph: Graph | null; error: string | null } {
  const links = useNoteLinks();
  const { notes: searchable, ready, error: notesError } = useSearchableNotes();
  const archivedQuery = useNotes(DEST.archive);
  const archived = archivedQuery.data;
  const chats = useChatTranscripts();
  const graph = useMemo(() => {
    // titles come from the note lists, not the projection: building before
    // they load drew a first frame of "Untitled" dots (canvas-graph audit, P2)
    if (!graphInputsReady(links.data, ready, archived)) return null;
    const linkable = [...searchable, ...(archived ?? []).filter((note) => note.kind !== "file"), ...chats];
    return buildGraph(linkable, links.data);
  }, [links.data, ready, searchable, archived, chats]);
  return { graph, error: graphError(links.error, notesError, archivedQuery.error) };
}
