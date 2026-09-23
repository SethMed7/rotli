// ⌘⌫ in the System browser — move the current multi-selection to Trash
// (the maintainer, 2026-07-28: Finder gestures end in Finder's delete). One executor,
// reusing the folder-trash ports so notes and files ride their own lanes;
// errors land in the sidebar's inline lane, partial progress stays honest.

import { isWebVault } from "../lib/browserVault";
import { corpusFileStat, corpusMoveFileToSink, corpusPurge } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { DEST } from "./destinations";
import { trashVirtualFolderItems } from "./folderTrash";
import { invalidateNotes } from "./hooks";
import { trashNoteWithImages } from "./noteLifecycle";
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
      trashNote: (id) => trashNoteWithImages(id),
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

/** Empty Trash (2026-07-31) — the ONLY hard-delete flow. Every item is purged
 * through `corpus_purge`, which re-checks in Rust that the note already lives
 * under Trash/ and routes the file into the macOS Trash (recoverable, never
 * oblivion). Partial failures stay honest: progress is reported, nothing
 * pretends the batch was atomic. */
export async function emptyTrash(): Promise<{ purged: number; failed: number }> {
  const ui = useUiStore.getState();
  ui.setRowActionError(null);
  // Rotli Web has no Rust purge: the connected vault deletes file by file
  // through the notes service (below)
  const items = await notesService.listNotes(DEST.trash);
  let purged = 0;
  const failures: string[] = [];
  for (const item of items) {
    try {
      if (isWebVault()) await notesService.deleteNote(item.id);
      else await corpusPurge(item.id);
      purged += 1;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  await invalidateNotes();
  if (failures.length > 0) {
    ui.setRowActionError(
      `Emptied ${purged} of ${items.length} — ${failures.length} couldn’t be deleted (${failures[0]}).`,
    );
  }
  return { purged, failed: failures.length };
}
