// Inline board rename, shared by the sidebar row AND the tab (the maintainer, 2026-06-26).
// `renamingBoardId` lives in the ui store so a right-click, a tab double-click, or
// a freshly-created board can all target the same inline input. Commit renames the
// .excalidraw on disk (corpus_rename_board) and retargets any open canvas tab to
// the new id so the board keeps showing.

import { useCallback } from "react";

import { corpusRenameBoard } from "../lib/tauri";
import { renameMainRef } from "../state/main";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { invalidateNotes } from "./hooks";

/** Rename a board file and carry its open tab and Main slot to the new id.
 * Rejects with the reason (read-only vault…) and changes nothing when it does. */
export async function renameBoardItem(boardId: string, raw: string): Promise<void> {
  const name = raw.trim();
  if (!name) return;
  const meta = await corpusRenameBoard(boardId, name);
  usePanesStore.getState().retargetBoard(boardId, meta.id);
  renameMainRef(boardId, meta.id); // the Main slot follows the new path id (#33)
  await invalidateNotes();
}

export function useBoardRename() {
  const renamingBoardId = useUiStore((s) => s.renamingBoardId);
  const setRenamingBoardId = useUiStore((s) => s.setRenamingBoardId);

  const commit = useCallback(
    async (boardId: string, raw: string) => {
      setRenamingBoardId(null);
      try {
        await renameBoardItem(boardId, raw);
      } catch (err) {
        // the row just snaps back — SAY why (read-only vault, name collision…);
        // the sidebar's inline error lane already exists for exactly this
        useUiStore
          .getState()
          .setRowActionError(
            `Couldn’t rename the board — ${err instanceof Error ? err.message : String(err)}`,
          );
      }
    },
    [setRenamingBoardId],
  );

  return {
    renamingBoardId,
    start: (id: string) => setRenamingBoardId(id),
    commit,
    cancel: () => setRenamingBoardId(null),
  };
}
