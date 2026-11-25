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

// Their own ["tags"] keys: the note caches' prefix patchers and cancels
// (hooks.ts) assume note-shaped data. invalidateNotes refreshes this prefix
// too, so a raw metadata edit, the Librarian, or an external change reaches
// every tag view.
const TAGS_KEY = ["tags"] as const;
const noteTagsKey = (id: string) => [...TAGS_KEY, id] as const;
const vaultTagsKey = [...TAGS_KEY, "\u0000vault"] as const;

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

/** The person's tag change on one note. Answers once the write lands (the
 * note's own tags are set from it); every other view refreshes behind it.
 * Throws the refusal (a tag that can't be one, a shape Rotli won't rewrite). */
export async function changeNoteTags(noteId: string, change: NoteTagChange): Promise<NoteTagsResult> {
  const result = await corpusChangeTags(noteId, change);
  queryClient.setQueryData(noteTagsKey(noteId), result.tags);
  void invalidateNotes();
  return result;
}
