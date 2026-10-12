// Owned metadata on a hand-written fenced note, matching the Rust corpus
// write_resolved / relocate paths. The browser has mtime but no birth time.
import type { NoteFrontmatter } from "../lib/frontmatter";
import { stampToMs, today, ulid } from "../memex/contract";

export function ownedNoteFacts(
  fm: NoteFrontmatter,
  fileModified: number,
  bodySave: boolean,
): NoteFrontmatter {
  const fileStamp = new Date(fileModified).toISOString().replace(/\.000Z$/, "Z");
  return {
    ...fm,
    id: fm.id || ulid(),
    created: stampToMs(fm.created) === null ? fileStamp : fm.created,
    updated: bodySave ? today() : stampToMs(fm.updated) === null ? fileStamp : fm.updated,
  };
}
