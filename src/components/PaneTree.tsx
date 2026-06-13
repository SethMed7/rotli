// The pane tree. EVERY leaf renders its tab strip now (Seth, 2026-06-13) — the
// old "single-tab pane renders zero chrome / Apple-Notes default" law is gone;
// a visible strip everywhere buys discoverability + a close x on every tab.
// Dividers: 1px border line, 8px hit zone, 2px cocoa-at-24% while dragging
// (token-derived, never clay). While a tab is mid-drag, each pane body wears a
// 5-region split-detach overlay: drop on the center to move the tab here, on
// an edge band to carve a split. Splits/focus/tabs/drag all live in the store.

import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { EditorSurface } from "../editor/EditorSurface";
import { activeTabOf, type DetachDir, leaves, usePanesStore } from "../state/panes";
import type { LeafNode, PaneNode, SplitNode } from "../types";
import { TabStrip } from "./TabStrip";

// the 5 dropzones over a pane body: 4 edge bands carve a split, center moves
type Zone = DetachDir | "center";
const EDGE_BAND = 0.22; // each edge band is ~22% of the pane's width/height

function zoneAt(rect: DOMRect, clientX: number, clientY: number): Zone {
  const fx = (clientX - rect.left) / Math.max(rect.width, 1);
  const fy = (clientY - rect.top) / Math.max(rect.height, 1);
  if (fx < EDGE_BAND && fx <= fy && fx <= 1 - fy) return "left";
  if (fx > 1 - EDGE_BAND && 1 - fx <= fy && 1 - fx <= 1 - fy) return "right";
  if (fy < EDGE_BAND) return "up";
  if (fy > 1 - EDGE_BAND) return "down";
  return "center";
}

function LeafView({ node }: { node: LeafNode }) {
  const focusedPaneId = usePanesStore((s) => s.focusedPaneId);
  const focusPane = usePanesStore((s) => s.focusPane);
  const draggingTab = usePanesStore((s) => s.draggingTab);
  const moveTab = usePanesStore((s) => s.moveTab);
  const detachTab = usePanesStore((s) => s.detachTab);
  const setDraggingTab = usePanesStore((s) => s.setDraggingTab);
  const tab = activeTabOf(node);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<Zone | null>(null);

  const onZoneOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggingTab) return;
    event.preventDefault();
    const el = bodyRef.current;
    if (!el) return;
    setZone(zoneAt(el.getBoundingClientRect(), event.clientX, event.clientY));
  };
  const onZoneDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const drag = draggingTab;
    setZone(null);
    setDraggingTab(null);
    if (!drag) return;
    event.preventDefault();
    const el = bodyRef.current;
    const where = el ? zoneAt(el.getBoundingClientRect(), event.clientX, event.clientY) : "center";
    if (where === "center") {
      // move to the end of this strip
      const target = leaves(usePanesStore.getState().root).find((l) => l.id === node.id);
      moveTab(drag.paneId, drag.tabId, node.id, target?.tabs.length ?? 0);
    } else {
      detachTab(drag.paneId, drag.tabId, node.id, where);
    }
  };

  return (
    <section
      className={node.id === focusedPaneId ? "pane focused" : "pane"}
      onMouseDownCapture={() => focusPane(node.id)}
    >
      <TabStrip pane={node} />
      {/* keyed by tab — each tab gets its own surface, so scroll/edit state
          never bleeds from the previously active tab */}
      <div className="pane-body" ref={bodyRef}>
        {tab.surfaceKind === "note" && (
          <EditorSurface key={tab.id} paneId={node.id} noteId={tab.noteId} />
        )}
        {/* split-detach overlay — pointer-active ONLY mid-drag, so it never
            blocks normal editing (Seth, 2026-06-13) */}
        {draggingTab && (
          <div
            className="pane-dropzones"
            onDragOver={onZoneOver}
            onDrop={onZoneDrop}
            onDragLeave={() => setZone(null)}
          >
            {(["left", "right", "up", "down", "center"] as const).map((z) => (
              <div key={z} className={zone === z ? `dz ${z} over` : `dz ${z}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SplitView({ node }: { node: SplitNode }) {
  const setSplitSizes = usePanesStore((s) => s.setSplitSizes);
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    const divider = event.currentTarget;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const total = node.dir === "row" ? rect.width : rect.height;
    if (total <= 0) return;
    const startPos = node.dir === "row" ? event.clientX : event.clientY;
    const startSizes = [...node.sizes];
    const minFrac = Math.min((node.dir === "row" ? 320 : 160) / total, 0.5);
    divider.classList.add("dragging");
    divider.setPointerCapture(event.pointerId);

    const onMove = (ev: globalThis.PointerEvent) => {
      const pos = node.dir === "row" ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / total;
      let a = (startSizes[index] ?? 0) + delta;
      let b = (startSizes[index + 1] ?? 0) - delta;
      if (a < minFrac) {
        b -= minFrac - a;
        a = minFrac;
      }
      if (b < minFrac) {
        a -= minFrac - b;
        b = minFrac;
      }
      const sizes = [...startSizes];
      sizes[index] = a;
      sizes[index + 1] = b;
      setSplitSizes(node.id, sizes);
    };
    const onUp = () => {
      divider.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // an interrupted pointer stream (gesture takeover, window hidden mid-drag)
    // must release the drag too, or the listeners live for the session
    window.addEventListener("pointercancel", onUp);
  };

  const parts: ReactNode[] = [];
  node.children.forEach((child, i) => {
    if (i > 0) {
      parts.push(
        <div
          key={`divider-${child.id}`}
          className="divider"
          role="separator"
          aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
          onPointerDown={startDrag(i - 1)}
        />,
      );
    }
    parts.push(
      <div
        key={child.id}
        className="cell"
        style={{ flexGrow: (node.sizes[i] ?? 1 / node.children.length) * 1000 }}
      >
        <PaneView node={child} />
      </div>,
    );
  });

  return (
    <div className={`split ${node.dir}`} ref={containerRef}>
      {parts}
    </div>
  );
}

function PaneView({ node }: { node: PaneNode }) {
  return node.kind === "leaf" ? <LeafView node={node} /> : <SplitView node={node} />;
}

export function PaneTree() {
  const root = usePanesStore((s) => s.root);
  const multi = leaves(root).length > 1;
  return (
    <div className={multi ? "panes multi" : "panes"}>
      <PaneView node={root} />
    </div>
  );
}
