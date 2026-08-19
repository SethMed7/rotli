// Dismissing a note from Main discards it when it's blank (the maintainer, 2026-07-07;
// hardened 2026-07-17): a blank scratch note you pulled into Main and never
// wrote in shouldn't linger in the corpus — and it bypasses the in-app Trash
// (corpus_discard_blank), because a never-written note was "just a view".

import { notesService } from "./notes";

/** True when the note's body holds no text at all. (The old check compared
 * titleOf(body) to "" — unsatisfiable, titleOf returns the literal "Untitled"
 * for an empty body, which left this feature dead since 2026-07-07.) */
export async function isEmptyNote(id: string): Promise<boolean> {
  const n = await notesService.getNote(id).catch(() => null);
  if (!n) return false;
  return (n.body ?? "").trim() === "";
}
