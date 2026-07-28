// ⌘⌫ in the System browser — move the current multi-selection to Trash
// (Seth, 2026-07-28: Finder gestures end in Finder's delete). One executor,
// reusing the folder-trash ports so notes and files ride their own lanes;
// errors land in the sidebar's inline lane, partial progress stays honest.

import { corpusFileStat, corpusMoveFileToSink } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { trashVirtualFolderItems } from "./folderTrash";
import { invalidateNotes } from "./hooks";
import { notesService } from "./notes";

export async function trashSystemSelection(): Promise<void> {
  const ui = useUiStore.getState();
  const items = ui.systemSelection;
  if (items.length === 0) return;
  ui.setRowActionError(null);
  try {
    await trashVirtualFolderItems(items, {
      fileStat: corpusFileStat,
      moveFile: corpusMoveFileToSink,
      trashNote: (id) => notesService.trashNote(id),
    });
    ui.setSystemSelection([]);
  } catch (err) {
    ui.setRowActionError(
      `Couldn’t move the selection to Trash — ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await invalidateNotes();
  }
}
