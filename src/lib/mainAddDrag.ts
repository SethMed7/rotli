// Drag a note (or board) INTO the Main tree from outside the sidebar — the
// All-notes list rows and (via tabDrag) editor tabs. Pointer-based, because HTML5
// drag is dead in the macOS WKWebView shell (Seth, 2026-07-07). It mirrors the
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
  // (Seth, 2026-07-29) — runs after the Main write, like every view assign
  const parent = mainParentOfNote(tree, noteId);
  if (parent && parent !== MAIN_ROOT) inheritFolderView(noteId, parent);
}

/** Begin a possible Main-add drag from a row's pointerdown. `id` is the note or
 * board id to add. A plain click falls through; real travel starts the drag. */
export function startMainAddDrag(event: ReactPointerEvent, id: string, label: string): void {
  let drop: { id: string; pos: DropPos } | null = null;
  let hovered: HTMLElement | null = null;

  const clearHover = () => {
    hovered?.classList.remove("main-dropover");
    hovered = null;
  };

  createPointerDragSession(event, {
    ghost: (x, y) => createDragGhost(label, x, y),
    onMove: (x, y) => {
      const at = mainDropAt(x, y);
      if (!at) {
        drop = null;
        clearHover();
        return;
      }
      if (hovered !== at.el) {
        clearHover();
        hovered = at.el;
        at.el.classList.add("main-dropover");
      }
      drop = { id: at.id, pos: at.pos };
    },
    onDrop: () => {
      if (drop) commitMainAdd(id, drop);
    },
    onEnd: clearHover,
    // swallow the trailing click so the row doesn't also open on drop
    swallowClick: true,
  });
}
