// A note card names its note by vault path (JSON Canvas `file`), while Rotli
// knows notes by id. These two pure functions translate both ways from the
// note list alone. A path no note answers to stays on the canvas as a
// "missing note" card — it is never deleted.

import { noteDiskFolder } from "../lib/noteLocation";
import type { NoteSummary } from "../types";

const stemOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
};
const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** The vault path a note card writes for `note`. A note identified by its
 * path uses it; otherwise its folder plus its file-name stem (the first alias
 * is the stem by contract), falling back to the title. */
export function notePath(
  note: Pick<NoteSummary, "id" | "title" | "aliases" | "folderId" | "diskFolderId">,
): string {
  if (note.id.toLowerCase().endsWith(".md")) return note.id;
  const folder = noteDiskFolder(note);
  const stem = note.aliases?.[0] ?? note.title;
  return folder ? `${folder}/${stem}.md` : `${stem}.md`;
}

/** The note a card's path names, or null. */
export function noteAtPath(notes: readonly NoteSummary[], path: string): NoteSummary | null {
  const exact = notes.find((note) => note.id === path);
  if (exact) return exact;
  const folder = folderOf(path);
  const stem = stemOf(path).toLocaleLowerCase();
  return (
    notes.find(
      (note) =>
        noteDiskFolder(note) === folder &&
        ((note.aliases ?? []).some((alias) => alias.toLocaleLowerCase() === stem) ||
          note.title.toLocaleLowerCase() === stem),
    ) ?? null
  );
}
