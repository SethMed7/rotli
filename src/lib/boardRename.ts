// Inline board rename, shared by the sidebar row AND the tab (Seth, 2026-06-26).
// `renamingBoardId` lives in the ui store so a right-click, a tab double-click, or
// a freshly-created board can all target the same inline input. Commit renames the
// .excalidraw on disk (corpus_rename_board) and retargets any open canvas tab to
// the new id so the board keeps showing.

import { useCallback } from "react";
import { invalidateNotes } from "../services/hooks";
import { renameMainRef } from "../state/main";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { corpusRenameBoard } from "./tauri";

export function useBoardRename() {
  const renamingBoardId = useUiStore((s) => s.renamingBoardId);
  const setRenamingBoardId = useUiStore((s) => s.setRenamingBoardId);
  const retargetBoard = usePanesStore((s) => s.retargetBoard);

  const commit = useCallback(
    async (boardId: string, raw: string) => {
      setRenamingBoardId(null);
      const name = raw.trim();
      if (!name) return;
      try {
        const meta = await corpusRenameBoard(boardId, name);
        retargetBoard(boardId, meta.id);
        renameMainRef(boardId, meta.id); // the Main slot follows the new path id (#33)
        await invalidateNotes();
      } catch {
        /* board is read-only or gone — leave it */
      }
    },
    [setRenamingBoardId, retargetBoard],
  );

  return {
    renamingBoardId,
    start: (id: string) => setRenamingBoardId(id),
    commit,
    cancel: () => setRenamingBoardId(null),
  };
}
