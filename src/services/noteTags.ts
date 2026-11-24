// The person's tags, for the app (2026-11-24): the note's tags, the vault's tag
// list, and the one application call that changes a note's tags and refreshes
// every view of them. The note header, the All notes filter, and the chat
// composer's `/tag` all go through here; policy is lib/noteTags.ts and the
// write is the person's lane (lib/corpusTags.ts → corpus_change_tags).

import { useQuery } from "@tanstack/react-query";

import { corpusChangeTags, corpusListTags, type NoteTagChange, type NoteTagsResult } from "../lib/corpusTags";
import { tagValues } from "../lib/noteTags";
import { corpusFrontmatter } from "../lib/tauri";
import { invalidateNotes } from "./hooks";
import { queryClient } from "./query";

// Under the ["note"] and ["notes"] umbrellas, so every write that refreshes
// notes (a raw metadata edit, the Librarian, an external change) refreshes
// tags too. A NUL-led segment never collides with a folder id or a note id.
const noteTagsKey = (id: string) => ["note", id, "\u0000tags"] as const;
const vaultTagsKey = ["notes", "\u0000tags"] as const;

/** One note's tags, in the order they're written. */
export function useNoteTags(noteId: string, enabled = true) {
  return useQuery({
    queryKey: noteTagsKey(noteId),
    queryFn: async () => tagValues((await corpusFrontmatter(noteId))?.fields ?? []),
    enabled,
  });
}

/** Every tag in the vault with its notes, most used first. */
export function useVaultTags(enabled = true) {
  return useQuery({ queryKey: vaultTagsKey, queryFn: corpusListTags, enabled });
}

/** The person's tag change on one note, then every tag view refreshes. Throws
 * the refusal (a tag that can't be one, a shape Rotli won't rewrite). */
export async function changeNoteTags(noteId: string, change: NoteTagChange): Promise<NoteTagsResult> {
  const result = await corpusChangeTags(noteId, change);
  queryClient.setQueryData(noteTagsKey(noteId), result.tags);
  await invalidateNotes();
  return result;
}
