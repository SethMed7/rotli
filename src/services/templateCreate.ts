// `/template` → Create new (the owner, 2026-09-21: "I should be able to create
// new right here"). Split from templates.ts, which stays a pure module: the
// folder rules and presets are read by the demo corpus, and importing the
// note services there would be a cycle.

import { noteDiskFolder } from "../lib/noteLocation";
import { invalidateMemex } from "../memex/useMemex";
import { createRoutedNote } from "./createNote";
import { invalidateNotes } from "./hooks";
import { inboxFolderId, notesService } from "./notes";
import { templatesFolderBeside } from "./templates";

/** `/template` → Create new: an ordinary note, made the ordinary way (so every
 * vault's creation route and gates apply), then moved into the Templates
 * folder. Resolves the new note's id. */
export async function createTemplateNote(): Promise<string> {
  const id = await createRoutedNote({
    selectedFolderId: "",
    isSmart: true,
    localFallback: inboxFolderId,
    body: "# New template\n\n",
  });
  const made = (await notesService.listAll()).find((note) => note.id === id);
  const target = templatesFolderBeside(made ? noteDiskFolder(made) : "");
  await notesService.moveNote(id, target);
  // the new note's title and folder must be known before its tab paints
  await Promise.all([invalidateNotes(), invalidateMemex()]);
  return id;
}
