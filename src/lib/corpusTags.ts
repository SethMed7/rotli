// A note's tags (2026-11-24): the person's add/remove and the vault's tag
// list. One shared `tags:` key; the policy is noteTags.ts, Rust owns every
// verdict on the Mac (corpus_tags.rs), and on the web the connected folder
// applies the same policy (services/folderTags.ts).

import { invoke } from "@tauri-apps/api/core";

import { isTauri, usesWebVaultIo } from "./tauri";
import { currentWebVaultIo } from "./webAiSeam";

/** Tags to add (each normalized, or the change is refused) and tags to take
 * off (matched as written, any case). */
export interface NoteTagChange {
  add?: string[];
  remove?: string[];
}

/** A tag write's answer: the note's tags now and its new revision. */
export interface NoteTagsResult {
  id: string;
  tags: string[];
  revision: string;
}

/** One tag across the vault: its most common spelling and its notes. */
export interface TagCount {
  tag: string;
  count: number;
  ids: string[];
}

/** The PERSON's tag change (note header chips, `/tag`). Works on locked and
 * secure notes. With `expectedRevision` a note changed since that read is
 * refused; without it the add/remove applies under the note's file lock. */
export async function corpusChangeTags(
  id: string,
  change: NoteTagChange,
  expectedRevision?: string,
): Promise<NoteTagsResult> {
  if (!isTauri() && usesWebVaultIo()) return currentWebVaultIo().changeTags(id, change, expectedRevision);
  if (!isTauri()) throw new Error("No vault is open.");
  return invoke<NoteTagsResult>("corpus_change_tags", {
    id,
    add: change.add ?? [],
    remove: change.remove ?? [],
    expectedRevision: expectedRevision ?? null,
  });
}

/** Every tag in the active vault with the notes that carry it, most used
 * first. The person's own view: secure notes count. */
export async function corpusListTags(): Promise<TagCount[]> {
  if (!isTauri() && usesWebVaultIo()) return currentWebVaultIo().listTags();
  if (!isTauri()) return [];
  return invoke<TagCount[]>("corpus_list_tags");
}
