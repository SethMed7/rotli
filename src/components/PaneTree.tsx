// The pane tree. A leaf with ONE tab renders zero tab chrome — the simple
// Apple-Notes default is this system at rest (r2 law). Dividers: 1px border
// line, 8px hit zone, 2px cocoa-at-24% while dragging (token-derived, never
// clay). Splits/focus/tabs all live in the panes store.

import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";
import { EditorSurface } from "../editor/EditorSurface";
import { activeTabOf, leaves, usePanesStore } from "../state/panes";
import type { LeafNode, PaneNode, SplitNode } from "../types";
import { TabStrip } from "./TabStrip";

function LeafView({ node }: { node: LeafNode }) {
  const focusedPaneId = usePanesStore((s) => s.focusedPaneId);
  const focusPane = usePanesStore((s) => s.focusPane);
  const tab = activeTabOf(node);

  return (
    <section
      className={node.id === focusedPaneId ? "pane focused" : "pane"}
      onMouseDownCapture={() => focusPane(node.id)}
    >
      {node.tabs.length > 1 && <TabStrip pane={node} />}
      {tab.surfaceKind === "note" && <EditorSurface noteId={tab.noteId} />}
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
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
