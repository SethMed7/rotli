// Pointer-based tab dragging (the maintainer, 2026-06-15). HTML5 drag-and-drop is flaky /
// often dead in the macOS WKWebView (wry) shell, so the tab strip drags with
// raw pointer events instead — these fire reliably everywhere. One gesture,
// owned by the tab you press: past a small threshold it starts a drag, paints a
// floating ghost (the shared lib/dragGhost — the Main tree and Board cards
// paint the same one), and hit-tests document.elementFromPoint against the panes'
// data-attributes (a strip → reorder/move at an index; a pane body → a 5-zone
// split-or-move). The panes store's dropPreview drives the live previews; the
// commit calls moveTab / detachTab. Cancels on Esc / pointercancel.

import type { PointerEvent as ReactPointerEvent } from "react";

import type { DropPos } from "../services/mainTree";
import { type DropPreview, type DropZone, leaves, usePanesStore } from "../state/panes";
import { createDragGhost } from "./dragGhost";
import { commitMainAdd, mainDropAt } from "./mainAddDrag";
import { createPointerDragSession } from "./pointerDrag";

const THRESHOLD_PX = 5;
const EDGE_BAND = 0.22; // mirror PaneTree's zoneAt

function zoneAt(rect: DOMRect, x: number, y: number): DropZone {
  const fx = (x - rect.left) / Math.max(rect.width, 1);
  const fy = (y - rect.top) / Math.max(rect.height, 1);
  if (fx < EDGE_BAND && fx <= fy && fx <= 1 - fy) return "left";
  if (fx > 1 - EDGE_BAND && 1 - fx <= fy && 1 - fx <= 1 - fy) return "right";
  if (fy < EDGE_BAND) return "up";
  if (fy > 1 - EDGE_BAND) return "down";
  return "center";
}

/** The pane target under a point: a strip (with its insertion index) or a
 * pane body's 5-zone split-or-move; null off the panes. Shared with the
 * sidebar's note drag (lib/paneDropDrag) so both paint the same previews. */
export function panePreviewAt(x: number, y: number): DropPreview {
  const el = document.elementFromPoint(x, y);
  const strip = el?.closest<HTMLElement>("[data-tabscroll]");
  if (strip?.dataset.paneId)
    return { kind: "strip", paneId: strip.dataset.paneId, index: stripIndex(strip, x) };
  const body = el?.closest<HTMLElement>("[data-pane-body]");
  if (body?.dataset.leafId) {
    return { kind: "zone", leafId: body.dataset.leafId, zone: zoneAt(body.getBoundingClientRect(), x, y) };
  }
  return null;
}

/** Pointer x vs each tab's midpoint within a strip → the insertion index. */
function stripIndex(scroll: HTMLElement, clientX: number): number {
  const tabs = Array.from(scroll.querySelectorAll<HTMLElement>("[data-tab-id]"));
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]?.getBoundingClientRect();
    if (rect && clientX < rect.left + rect.width / 2) return i;
  }
  return tabs.length;
}

/** Begin tracking a possible drag from a tab's pointerdown. A plain click (no
 * travel) falls through to the tab's onClick; real travel starts the drag. */
export function startTabDrag(
  event: ReactPointerEvent,
  fromPaneId: string,
  tabId: string,
  label: string,
): void {
  // a tab can also be dropped onto the sidebar's Main tree → add it to Main
  let mainDrop: { id: string; pos: DropPos } | null = null;
  let mainHover: HTMLElement | null = null;
  const clearMainHover = () => {
    mainHover?.classList.remove("main-dropover");
    mainHover = null;
  };

  const store = () => usePanesStore.getState();

  const hitTest = (x: number, y: number) => {
    // reset the Main-drop candidate each move; the branches below re-set it
    clearMainHover();
    mainDrop = null;
    const pane = panePreviewAt(x, y);
    if (pane) {
      store().setDropPreview(pane);
      return;
    }
    // over the sidebar's Main tree → highlight the row, arm a Main add
    const at = mainDropAt(x, y);
    if (at) {
      store().setDropPreview(null);
      mainDrop = { id: at.id, pos: at.pos };
      mainHover = at.el;
      at.el.classList.add("main-dropover");
      return;
    }
    store().setDropPreview(null);
  };

  const commit = () => {
    const s = store();
    // dropped onto Main → add this tab's note/board to Main (a board too — you
    // can shelve a canvas). Resolve the tab to its id from the live pane tree.
    if (mainDrop) {
      const pane = leaves(s.root).find((p) => p.id === fromPaneId);
      const tab = pane?.tabs.find((t) => t.id === tabId);
      const mainId =
        tab?.surfaceKind === "note" ? tab.noteId : tab?.surfaceKind === "canvas" ? tab.boardId : null;
      if (mainId) commitMainAdd(mainId, mainDrop);
      return;
    }
    const preview = s.dropPreview;
    if (!preview) return;
    if (preview.kind === "strip") {
      s.moveTab(fromPaneId, tabId, preview.paneId, preview.index);
    } else if (preview.zone === "center") {
      s.moveTab(fromPaneId, tabId, preview.leafId, Number.MAX_SAFE_INTEGER); // end of strip
    } else {
      s.detachTab(fromPaneId, tabId, preview.leafId, preview.zone);
    }
  };

  createPointerDragSession(event, {
    // historical tab feel: EITHER axis clearing the threshold starts the drag
    // (the shared default is the Manhattan sum)
    passedThreshold: (dx, dy) => Math.abs(dx) >= THRESHOLD_PX || Math.abs(dy) >= THRESHOLD_PX,
    ghost: (x, y) => createDragGhost(label, x, y),
    onStart: () => {
      store().setDraggingTab({ paneId: fromPaneId, tabId });
      document.documentElement.dataset.tabDragging = "true";
    },
    onMove: hitTest,
    // commit runs BEFORE onEnd (session contract) — it reads the store's
    // dropPreview, which onEnd clears
    onDrop: commit,
    onEnd: () => {
      clearMainHover();
      delete document.documentElement.dataset.tabDragging;
      const s = store();
      s.setDraggingTab(null);
      s.setDropPreview(null);
    },
    // swallow the click that fires after a drag so it doesn't re-activate a tab
    swallowClick: true,
  });
}
