// Feeds the imperative wikilink index (wikilinkIndex.ts) from React, and
// re-decorates the open editor when what a link can resolve to changes. Split
// out of cmEditor.tsx, which sits at its size ceiling.
//
// What a `[[link]]` can point at: every searchable note, ARCHIVED notes (they
// still exist — only Trash reads as deleted; the maintainer, 2026-07-28), and
// CHATS (1.3.0: `/Link chat`). A chat is a transcript file in the vault, so it
// links like any note; the opener shows it as a conversation.

import type { EditorView } from "@codemirror/view";
import { type RefObject, useEffect, useMemo } from "react";

import { DEST } from "../services/destinations";
import { useChatTranscripts, useNotes, useSearchableNotes } from "../services/hooks";
import type { NoteSummary } from "../types";
import { setWikilinkNotes } from "./wikilinkIndex";

export function useWikilinkIndex(viewRef: RefObject<EditorView | null>): {
  /** Everything a link can resolve to — what a new link's label must be unique in. */
  linkable: NoteSummary[];
} {
  const { notes: searchableNotes } = useSearchableNotes();
  const archivedNotes = useNotes(DEST.archive).data;
  const chats = useChatTranscripts();
  const linkable = useMemo(() => {
    const archived = (archivedNotes ?? []).filter((n) => n.kind !== "file");
    return archived.length || chats.length ? [...searchableNotes, ...archived, ...chats] : searchableNotes;
  }, [searchableNotes, archivedNotes, chats]);

  useEffect(() => {
    // the index answers whether anything a link READS changed (id, title,
    // aliases): list identity churns on every save while typing, and a
    // whole-document wikilink re-decoration per keystroke is what the perf
    // audit (2026-07-30, finding 9) removed
    if (!setWikilinkNotes(linkable)) return;
    // re-decorate: the resolved-vs-missing look reads the index, which lands
    // async after the view first painted — an explicit (no-move) selection
    // transaction is the cheapest "selectionSet" rebuild trigger
    const view = viewRef.current;
    if (view) view.dispatch({ selection: view.state.selection });
  }, [linkable, viewRef]);

  return { linkable };
}
