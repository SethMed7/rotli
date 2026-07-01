// useNoteMenu — one hook that builds the right-click menu for a note/file/board
// row and opens the context-menu store. Centralizes the item list + every
// handler so any surface (sidebar, All-notes, Recent, Main) wires it the same
// way: `const openMenu = useNoteMenu(); ... onContextMenu={(e) => openMenu(e, note)}`.

import { type MouseEvent, useCallback, useMemo } from "react";
import { useArchiveNote, useNotes, useTrashNote } from "../services/hooks";
import { addNoteToMain, mainHasNote, removeFromMain } from "../services/mainTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useMainStore } from "../state/main";
import { usePanesStore } from "../state/panes";
import { QUICK_MAX, togglePinQuick } from "../state/quick";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";

export function useNoteMenu() {
  const open = useContextMenu((s) => s.open);
  const openSummary = usePanesStore((s) => s.openSummary);
  const quickIds = useUiStore((s) => s.quickNoteIds);
  const setRenameTarget = useUiStore((s) => s.setRenameTarget);
  const manifest = useMainStore((s) => s.manifest);
  const setTree = useMainStore((s) => s.setTree);
  const allNotes = useNotes().data ?? [];
  const liveIds = useMemo(() => new Set(allNotes.map((n) => n.id)), [allNotes]);
  const archive = useArchiveNote();
  const trash = useTrashNote();

  return useCallback(
    (e: MouseEvent, note: NoteSummary) => {
      e.preventDefault();
      e.stopPropagation();
      const isFile = note.kind === "file";
      const isBoard = note.kind === "board";
      const inMain = mainHasNote(manifest.tree, note.id);
      const starred = quickIds.includes(note.id);
      const full = !starred && quickIds.length >= QUICK_MAX;

      const items: MenuSpec[] = [];
      items.push({
        kind: "action" as const,
        label: "Open in new tab",
        onClick: () => openSummary(note, { newTab: true }),
      });
      items.push({ kind: "sep" as const });
      if (!isBoard) {
        items.push({
          kind: "action" as const,
          label: starred ? "Unstar — remove from Quick access" : "Star for Quick access",
          checked: starred,
          disabled: full,
          onClick: () => togglePinQuick(note.id),
        });
      }
      items.push({
        kind: "action" as const,
        label: inMain ? "Remove from Main" : "Add to Main",
        onClick: () =>
          setTree(
            inMain ? removeFromMain(manifest.tree, note.id) : addNoteToMain(manifest.tree, note.id),
            liveIds,
          ),
      });
      if (!isFile) {
        items.push({ kind: "sep" as const });
        items.push({
          kind: "action" as const,
          label: "Rename…",
          onClick: () =>
            isBoard
              ? useUiStore.getState().setRenamingBoardId(note.id)
              : setRenameTarget({ id: note.id, current: note.title }),
        });
      }
      items.push({ kind: "sep" as const });
      if (!isFile) {
        items.push({
          kind: "action" as const,
          label: "Archive",
          onClick: () => archive.mutate(note.id),
        });
      }
      items.push({
        kind: "action" as const,
        label: isFile ? "Delete file" : "Delete",
        danger: true,
        onClick: () => trash.mutate(note.id),
      });

      open(e.clientX, e.clientY, items);
    },
    [open, openSummary, quickIds, manifest, setTree, liveIds, archive, trash, setRenameTarget],
  );
}
