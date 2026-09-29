// A note made from inside another note (2026-09-29): the Link note picker's
// "Create" row and the "Continue a project list" function. It's a real note in
// the vault's usual place, filed in Main beside the note it belongs with, so it
// shows up where the person is working.

import { useMainStore } from "../state/main";
import { ALL_NOTES } from "../state/ui";
import type { NoteSummary } from "../types";
import { createRoutedNote } from "./createNote";
import { invalidateNotes } from "./hooks";
import { addNoteToMainAt, MAIN_ROOT, mainParentOfNote } from "./mainTree";
import { inboxFolderId, notesService } from "./notes";

export async function createLinkedNote(
  title: string,
  options: { body?: string; besideNoteId?: string | undefined } = {},
): Promise<NoteSummary> {
  const name = title.trim();
  if (!name) throw new Error("a new note needs a title");
  const id = await createRoutedNote({
    selectedFolderId: ALL_NOTES,
    isSmart: true,
    localFallback: inboxFolderId,
    body: options.body ?? `# ${name}\n\n`,
  });
  const main = useMainStore.getState();
  const parent =
    (options.besideNoteId && mainParentOfNote(main.manifest.tree, options.besideNoteId)) || MAIN_ROOT;
  main.setTree(addNoteToMainAt(main.manifest.tree, id, parent));
  await invalidateNotes();
  const note = await notesService.getNote(id);
  if (!note) throw new Error("the new note could not be read back");
  return note;
}
