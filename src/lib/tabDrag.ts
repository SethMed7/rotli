// Pointer-based tab dragging (Seth, 2026-06-15). HTML5 drag-and-drop is flaky /
// often dead in the macOS WKWebView (wry) shell, so the tab strip drags with
// raw pointer events instead — these fire reliably everywhere. One gesture,
// owned by the tab you press: past a small threshold it starts a drag, paints a
// floating ghost, and hit-tests document.elementFromPoint against the panes'
// data-attributes (a strip → reorder/move at an index; a pane body → a 5-zone
// split-or-move). The panes store's dropPreview drives the live previews; the
// commit calls moveTab / detachTab. Cancels on Esc / pointercancel.

import type { PointerEvent as ReactPointerEvent } from "react";
import { type DropZone, usePanesStore } from "../state/panes";

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
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;

  const store = () => usePanesStore.getState();

  const begin = () => {
    dragging = true;
    store().setDraggingTab({ paneId: fromPaneId, tabId });
    document.documentElement.dataset.tabDragging = "true";
    ghost = document.createElement("div");
    ghost.className = "tab-ghost";
    ghost.textContent = label;
    document.body.appendChild(ghost);
  };

  const hitTest = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const strip = el?.closest<HTMLElement>("[data-tabscroll]");
    if (strip?.dataset.paneId) {
      store().setDropPreview({ kind: "strip", paneId: strip.dataset.paneId, index: stripIndex(strip, x) });
      return;
    }
    const body = el?.closest<HTMLElement>("[data-pane-body]");
    if (body?.dataset.leafId) {
      store().setDropPreview({
        kind: "zone",
        leafId: body.dataset.leafId,
        zone: zoneAt(body.getBoundingClientRect(), x, y),
      });
      return;
    }
    store().setDropPreview(null);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < THRESHOLD_PX && Math.abs(e.clientY - startY) < THRESHOLD_PX) {
        return;
      }
      begin();
    }
    if (ghost) {
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    }
    hitTest(e.clientX, e.clientY);
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("keydown", onKey, true);
    ghost?.remove();
    ghost = null;
    delete document.documentElement.dataset.tabDragging;
    const s = store();
    s.setDraggingTab(null);
    s.setDropPreview(null);
  };

  const commit = () => {
    const s = store();
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

  const onUp = () => {
    const wasDragging = dragging;
    if (wasDragging) commit();
    cleanup();
    if (wasDragging) {
      // swallow the click that fires after a drag so it doesn't re-activate a tab
      const swallow = (ce: MouseEvent) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 60);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", cleanup);
  window.addEventListener("keydown", onKey, true);
}
