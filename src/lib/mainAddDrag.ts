// Drag a note (or board) INTO the Main tree from outside the sidebar — the
// All-notes list rows and (via tabDrag) editor tabs. System-browser items may
// also land on the sidebar's Trash row. Pointer-based, because HTML5
// drag is dead in the macOS WKWebView shell (the maintainer, 2026-07-07). It mirrors the
// sidebar's own "add" drag: a floating ghost rides the cursor, the hovered Main
// row highlights (`.main-dropover`), and on drop the note is added to Main at that
// spot. A plain click (no travel) falls through to the row's own handler.
//
// The commit uses the Main store directly (no React context needed), so any
// surface can start a Main-add drag by calling this on a row's pointerdown.

import type { PointerEvent as ReactPointerEvent } from "react";

import { inheritFolderView } from "../newItems/composition";
import { MAIN_ROOT, addNoteToMain, type DropPos, mainParentOfNote, moveInTree } from "../services/mainTree";
import { useMainStore } from "../state/main";
import { createDragGhost } from "./dragGhost";
import { createPointerDragSession } from "./pointerDrag";

/** Resolve the Main drop under a point: which row (`data-main-id`) and where
 * (before/after, or `into` a folder / the whole-Main zone). Null if not over Main.
 * Shared so tabDrag hit-tests Main identically. */
export function mainDropAt(x: number, y: number): { el: HTMLElement; id: string; pos: DropPos } | null {
  const hit = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
    "[data-main-id]",
  ) as HTMLElement | null;
  const id = hit?.dataset.mainId;
  if (!hit || !id) return null;
  const rect = hit.getBoundingClientRect();
  const rel = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  let pos: DropPos = rel < 0.5 ? "before" : "after";
  if (hit.dataset.mainFolder === "1" && rel > 0.33 && rel < 0.67) pos = "into";
  if (id === MAIN_ROOT) pos = "into"; // the whole Main zone → land at root
  return { el: hit, id, pos };
}

/** Add `noteId` to Main at a resolved drop (root add if the zone/root). Shared
 * commit for every Main-add drag source. */
export function commitMainAdd(noteId: string, drop: { id: string; pos: DropPos }): void {
  const m = useMainStore.getState();
  let tree = addNoteToMain(m.manifest.tree, noteId);
  if (drop.id !== MAIN_ROOT) tree = moveInTree(tree, noteId, drop.id, drop.pos);
  m.setTree(tree);
  // landing in a folder a named view mirrors makes the item show THERE too
  // (the maintainer, 2026-07-29) — runs after the Main write, like every view assign
  const parent = mainParentOfNote(tree, noteId);
  if (parent && parent !== MAIN_ROOT) inheritFolderView(noteId, parent);
}

/** Begin a possible cross-surface drag from a row's pointerdown. `id` is the
 * note or board id to add to Main; callers may additionally expose Trash. A
 * plain click falls through; real travel starts the drag. */
export function startMainAddDrag(
  event: ReactPointerEvent,
  id: string,
  label: string,
  opts?: { allowMain?: boolean; onTrash?: () => void },
): void {
  let drop: { kind: "main"; id: string; pos: DropPos } | { kind: "trash" } | null = null;
  let hovered: HTMLElement | null = null;

  const clearHover = () => {
    hovered?.classList.remove("main-dropover");
    hovered = null;
  };

  createPointerDragSession(event, {
    ghost: (x, y) => createDragGhost(label, x, y),
    onMove: (x, y) => {
      const trash = opts?.onTrash
        ? ((document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
            '[data-system-trash-drop="1"]',
          ) as HTMLElement | null)
        : null;
      const at = opts?.allowMain === false ? null : mainDropAt(x, y);
      const nextHovered = trash ?? at?.el ?? null;
      if (hovered !== nextHovered) {
        clearHover();
        hovered = nextHovered;
        hovered?.classList.add("main-dropover");
      }
      if (trash) {
        drop = { kind: "trash" };
        return;
      }
      if (!at) {
        drop = null;
        return;
      }
      drop = { kind: "main", id: at.id, pos: at.pos };
    },
    onDrop: () => {
      if (drop?.kind === "trash") opts?.onTrash?.();
      else if (drop?.kind === "main") commitMainAdd(id, drop);
    },
    onEnd: clearHover,
    // swallow the trailing click so the row doesn't also open on drop
    swallowClick: true,
  });
}
