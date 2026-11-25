// One live read of a note's protection (secure, locked, the AI-edit verdict),
// shared by every surface that shows it. The Aa panel used to read it once when
// it opened, so a ⌘⇧L, a row-menu toggle, or an edit made outside Rotli left it
// showing the old state (2026-11-24). Every write path ends in invalidateNotes,
// which refreshes this query too, so the panel reads the same truth the header
// and the lists do. It is its own key, not a child of ["note", id]: the editor's
// read ordering cancels and counts that prefix (noteReads.ts).

import { useQuery } from "@tanstack/react-query";

import { corpusFrontmatter } from "../lib/tauri";
import { queryClient } from "./query";

const NOTE_PROTECTION = "note-protection";

export const noteProtectionOptions = (noteId: string) => ({
  queryKey: [NOTE_PROTECTION, noteId] as const,
  queryFn: () => corpusFrontmatter(noteId),
});

/** `undefined` until the first read lands; `null` when the note has no frontmatter to read. */
export function useNoteProtection(noteId: string, enabled: boolean) {
  return useQuery({ ...noteProtectionOptions(noteId), enabled }).data;
}

export function invalidateNoteProtection(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [NOTE_PROTECTION] });
}
