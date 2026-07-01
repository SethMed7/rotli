// Manual Brain filing — ONE path shared by every surface that files a staged
// note into a wiki area (the metadata panel's "File to the Brain" and the
// right-click menu's drill). Sets the AI `area` field, moves the note through
// the v3.7 Filer gate, retargets any open pane, and journals the action so
// Brain Activity can show + undo it. UI concerns (busy/error/close) stay with
// the callers.

import { corpusFileNote, corpusSetAiField } from "../lib/tauri";
import { usePanesStore } from "../state/panes";
import { logAction } from "./brainJournal";
import { invalidateNotes } from "./hooks";

/** True when this note is STAGED (wiki/_inbox) — the only notes the manual
 * filing affordances offer to file. */
export function isStagedNote(noteId: string): boolean {
  return noteId.includes("wiki/_inbox");
}

/** File a staged note into `wiki/<area>`: set the AI area field, move through
 * the Filer gate, retarget open panes, journal it, refresh. Returns the note's
 * new wire id. Throws on refusal (locked note, bad area) — callers surface it. */
export async function fileNoteToArea(noteId: string, area: string): Promise<string> {
  const before = noteId.slice(0, noteId.lastIndexOf("/"));
  const title = (noteId.split("/").pop() ?? noteId)
    .replace(/-[a-z0-9]{6}\.md$/i, "")
    .replace(/\.md$/, "");
  await corpusSetAiField(noteId, "area", area);
  const newId = await corpusFileNote(noteId);
  usePanesStore.getState().retargetNote(noteId, newId);
  await logAction({
    action: "file",
    noteId: newId,
    noteTitle: title,
    area,
    before,
    after: newId.slice(0, newId.lastIndexOf("/")),
  });
  await invalidateNotes();
  return newId;
}
