// Rotli Web's tag lanes: the twin of src-tauri/src/corpus_tags.rs for a
// connected folder. The person may add and remove any tag on a note they can
// open, locked and secure ones included; a tag write never changes how the
// note is protected. The policy (what a tag may be, how the `tags:` line is
// edited) is src/lib/noteTags.ts, pinned to Rust by parity.json.

import { composeNoteDocument, emptyFrontmatter, parseNoteDocument } from "../lib/frontmatter";
import { composeInPlace, rotliMade } from "../lib/frontmatterInPlace";
import { rawFrontmatterBlock } from "../lib/frontmatterRaw";
import {
  applyTagChange,
  applyTagChangeToBlock,
  normalizeTag,
  TAGS_PER_CHANGE_MAX,
  tagValues,
} from "../lib/noteTags";
import { protection } from "../lib/protectionRule";
import { readVersionedFile, writeVersionedFile } from "./folderFileIo";
import { type VaultDir, vaultOpenedInPlace } from "./vaultDir";

export interface NoteTagChange {
  add?: readonly string[];
  remove?: readonly string[];
}

export interface TagWrite {
  tags: string[];
  revision: string;
}

/** The change's new tags, normalized; throws the first refusal. */
export function normalizedAdd(change: NoteTagChange): string[] {
  const add = change.add ?? [];
  const remove = change.remove ?? [];
  if (add.length + remove.length > TAGS_PER_CHANGE_MAX)
    throw new Error(`one change adds or removes at most ${TAGS_PER_CHANGE_MAX} tags`);
  if (add.length === 0 && remove.length === 0) throw new Error("name at least one tag to add or remove");
  return add.map((input) => {
    const verdict = normalizeTag(input);
    if (!verdict.ok) throw new Error(verdict.reason);
    return verdict.tag;
  });
}

/** `text` with the change applied, or null when nothing changes. Refuses a
 * change that would alter the note's protection. */
export async function taggedText(
  dir: VaultDir,
  text: string,
  add: readonly string[],
  remove: readonly string[],
): Promise<string | null> {
  // a byte-order mark hides the frontmatter from every reader, so a fence
  // added above it would push the note's own metadata into its body
  if (text.startsWith("\uFEFF"))
    throw new Error(
      "this note starts with a byte-order mark, so Rotli won't change its tags; remove the mark first",
    );
  // a note with frontmatter changes only its `tags:` lines; one without gets
  // the fence a note of this vault is written with
  const block = rawFrontmatterBlock(text);
  let out: string;
  if (block) {
    const spliced = applyTagChangeToBlock(block, add, remove);
    if (!spliced.ok) throw new Error(spliced.reason);
    if (spliced.block === null) return null;
    out = spliced.block + text.slice(block.length);
  } else {
    const { frontmatter, body } = parseNoteDocument(text);
    const fm = frontmatter ?? emptyFrontmatter();
    const edit = applyTagChange(fm.foreign, add, remove);
    if (!edit.ok) throw new Error(edit.reason);
    if (!edit.fields) return null;
    const next = { ...fm, foreign: edit.fields };
    const inPlace = !rotliMade(frontmatter) && (await vaultOpenedInPlace(dir));
    out = inPlace ? composeInPlace(text, next) : composeNoteDocument(next, body);
  }
  if (JSON.stringify(protection(text)) !== JSON.stringify(protection(out)))
    throw new Error("refused: changing tags may not change how this note is protected");
  return out;
}

/** The person's tag change on one connected-folder note. */
export async function changeFolderTags(
  dir: VaultDir,
  path: string,
  change: NoteTagChange,
  expectedRevision?: string,
): Promise<TagWrite> {
  if (!path.toLowerCase().endsWith(".md")) throw new Error("only Markdown notes carry tags");
  const add = normalizedAdd(change);
  const opened = await readVersionedFile(dir, path);
  if (expectedRevision && opened.revision !== expectedRevision)
    throw new Error("revision conflict: the note changed since it was read");
  const out = await taggedText(dir, opened.contents, add, change.remove ?? []);
  if (out === null)
    return {
      tags: tagValues(parseNoteDocument(opened.contents).frontmatter?.foreign ?? []),
      revision: opened.revision,
    };
  const revision = await writeVersionedFile(dir, path, out, opened.revision);
  return { tags: tagValues(parseNoteDocument(out).frontmatter?.foreign ?? []), revision };
}

export interface FolderTagCount {
  tag: string;
  count: number;
  ids: string[];
}

/** Every tag on the given notes, most used first, under its most common
 * spelling (the first seen wins a tie). */
export function countTags(notes: readonly { id: string; fields: readonly string[] }[]): FolderTagCount[] {
  const counts = new Map<string, { count: FolderTagCount; spellings: Map<string, number> }>();
  for (const note of notes) {
    const seen = new Set<string>();
    for (const tag of tagValues(note.fields)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? {
        count: { tag, count: 0, ids: [] as string[] },
        spellings: new Map<string, number>(),
      };
      counts.set(key, entry);
      entry.count.count++;
      entry.count.ids.push(note.id);
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1);
    }
  }
  const out = [...counts.values()].map(({ count, spellings }) => {
    let best: [string, number] | null = null;
    for (const [spelling, n] of spellings) if (!best || n > best[1]) best = [spelling, n];
    return { ...count, tag: best ? best[0] : count.tag };
  });
  return out.sort((a, b) => b.count - a.count || cmpLower(a.tag, b.tag));
}

// Rust's String ordering on lowercased text: by code point, not locale
function cmpLower(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
