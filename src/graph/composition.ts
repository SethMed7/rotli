// Wires the Graph view to the vault: the Links projection (Rust on the Mac,
// the TS twin on the web) resolved against the same linkable set the editor
// uses (useWikilinkIndex), so an edge here is a link that opens there.

import { useMemo } from "react";

import { DEST } from "../services/destinations";
import { useChatTranscripts, useNoteLinks, useNotes, useSearchableNotes } from "../services/hooks";
import { type Graph, buildGraph } from "./model";

export function useVaultGraph(): { graph: Graph | null; error: string | null } {
  const links = useNoteLinks();
  const { notes: searchable } = useSearchableNotes();
  const archived = useNotes(DEST.archive).data;
  const chats = useChatTranscripts();
  const graph = useMemo(() => {
    if (!links.data) return null;
    const linkable = [...searchable, ...(archived ?? []).filter((note) => note.kind !== "file"), ...chats];
    return buildGraph(linkable, links.data);
  }, [links.data, searchable, archived, chats]);
  const error = links.error
    ? links.error instanceof Error
      ? links.error.message
      : String(links.error)
    : null;
  return { graph, error };
}
