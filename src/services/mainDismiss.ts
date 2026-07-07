// Dismissing a note from Main deletes it when it's empty (Seth, 2026-07-07): a
// blank scratch note you pulled into Main and never wrote in shouldn't linger in
// the corpus after you dismiss it. "Empty" = no title AND no body text.

import { titleOf, snippetOf } from "./derive";
import { notesService } from "./notes";

/** True when the note has no title and no body text — nothing worth keeping. */
export async function isEmptyNote(id: string): Promise<boolean> {
  const n = await notesService.getNote(id).catch(() => null);
  if (!n) return false;
  const body = n.body ?? "";
  return titleOf(body).trim() === "" && snippetOf(body).trim() === "";
}
