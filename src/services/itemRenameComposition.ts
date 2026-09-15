// Composition for renaming a document/sheet: joins the pure rename workflow to
// the document sessions, the notes adapter, open tabs, and Main/view projections.

import { flushDirtyDocuments } from "../documents/session";
import { extOf } from "../lib/fileKind";
import { renameMainRef } from "../state/main";
import { usePanesStore } from "../state/panes";
import { useViewsStore } from "../state/views";
import { invalidateNotes } from "./hooks";
import { renameFileItem } from "./itemRename";
import { notesService } from "./notes";
import { renameViewItemRef } from "./viewTree";

/** Rename a document/sheet file. Rejects with a person-readable reason (a taken
 * name, a read-only vault) and leaves tabs and references untouched when it does. */
export function renameManagedFile(id: string, name: string): Promise<string | null> {
  return renameFileItem(
    {
      // an open sheet parks its edits the same way; its session module carries
      // the workbook codec, so load it only when a sheet is being renamed
      flushDocuments: async () => {
        await flushDirtyDocuments();
        if (extOf(id) !== "xlsx") return;
        const { flushDirtySheets } = await import("../sheets/session");
        await flushDirtySheets();
      },
      rename: (fileId, next) => notesService.renameFile(fileId, next),
      retarget: (oldId, newId) => usePanesStore.getState().retargetFile(oldId, newId),
      renameReferences: (oldId, newId) => {
        renameMainRef(oldId, newId);
        const views = useViewsStore.getState();
        const next = renameViewItemRef(views.manifest, oldId, newId);
        if (JSON.stringify(next) !== JSON.stringify(views.manifest)) views.setManifest(next);
      },
      refresh: invalidateNotes,
    },
    id,
    name,
  );
}
