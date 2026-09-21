// Note templates (1.3.0). A template is an ordinary Markdown note that lives in
// the Templates folder — `wiki/Templates` in a memex vault, `Templates` in a
// plain notes folder (the Welcome folder's layout twin). Nothing about it is
// special on disk: no frontmatter key, no `.rotli/` state. It is made, edited,
// moved and trashed like any note, and `/template` lists what is in the folder.

import { noteDiskFolder } from "../lib/noteLocation";
import type { NoteSummary } from "../types";

export const TEMPLATES_FOLDER = "Templates";
export const TEMPLATES_BRAIN_FOLDER = "wiki/Templates";

/** The PHYSICAL folder decides, never the shelf projection: a template that
 * carries a shelf still projects elsewhere as `folderId`. Subfolders count. */
export function isTemplateFolder(diskFolderId: string): boolean {
  return [TEMPLATES_FOLDER, TEMPLATES_BRAIN_FOLDER].some(
    (root) => diskFolderId === root || diskFolderId.startsWith(`${root}/`),
  );
}

/** What `/template` may offer. A SECURE template is left out: inserting its
 * body would copy protected text into a note that is not. */
export function isTemplateNote(note: NoteSummary): boolean {
  return (note.kind ?? "note") === "note" && !note.secure && isTemplateFolder(noteDiskFolder(note));
}
