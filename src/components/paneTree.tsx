// The pane tree. EVERY leaf renders its tab strip now (Seth, 2026-06-13) — the
// old "single-tab pane renders zero chrome / Apple-Notes default" law is gone;
// a visible strip everywhere buys discoverability + a close x on every tab.
// Dividers: 1px border line, 8px hit zone, 2px cocoa-at-24% while dragging
// (token-derived, never clay). While a tab is mid-drag, each pane body wears a
// 5-region split-detach overlay: drop on the center to move the tab here, on
// an edge band to carve a split. Splits/focus/tabs/drag all live in the store.

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useRef,
} from "react";
import { EditorSurface } from "../editor/editorSurface";
import { ChatSurface } from "./chatSurface";
import { ActivitySurface } from "./activitySurface";
import { FileSurface } from "./fileSurface";
import { activeTabOf, leaves, refitColumns, usePanesStore } from "../state/panes";
import { dispatch } from "../keys/registry";
import type { LeafNode, PaneNode, SplitNode } from "../types";
import { Character } from "./character";
import { TabStrip } from "./tabStrip";

// Excalidraw is heavy (~3.5MB with its mermaid/katex deps) and most sessions
// never open a board — code-split it so it loads only when a canvas tab mounts,
// keeping the main bundle lean (Seth, 2026-06-24).
const CanvasSurface = lazy(() => import("./canvasSurface").then((m) => ({ default: m.CanvasSurface })));

/** All tabs closed (only possible in the lone pane) — the quokka rest state
 * (Seth, 2026-07-28: "close all tabs and have an empty state"). Quiet, with
 * the three ways back in. */
function PaneEmptyState() {
  return (
    <div className="list-empty pane-empty">
      <Character name="rest" size={120} className="be-quokka" />
      <p className="be-title">All clear</p>
      <p className="be-sub">
        <button type="button" className="pane-empty-act" onClick={() => dispatch("notes.new")}>
          <kbd>⌘N</kbd> new note
        </button>
        <button type="button" className="pane-empty-act" onClick={() => dispatch("palette.toggle")}>
          <kbd>⌘K</kbd> search
        </button>
        <button
          type="button"
          className="pane-empty-act"
          onClick={() => usePanesStore.getState().reopenClosedTab()}
        >
          <kbd>⌘⇧T</kbd> reopen tab
        </button>
      </p>
    </div>
  );
}

function LeafView({ node }: { node: LeafNode }) {
  const focusedPaneId = usePanesStore((s) => s.focusedPaneId);
  const focusPane = usePanesStore((s) => s.focusPane);
  const draggingTab = usePanesStore((s) => s.draggingTab);
  // the highlighted zone for THIS pane (driven by lib/tabDrag's hit-testing)
  const zone = usePanesStore((s) =>
    s.dropPreview?.kind === "zone" && s.dropPreview.leafId === node.id ? s.dropPreview.zone : null,
  );
  const tab = activeTabOf(node);

  return (
    <section
      className={node.id === focusedPaneId ? "pane focused" : "pane"}
      onMouseDownCapture={() => focusPane(node.id)}
    >
      <TabStrip pane={node} />
      {/* keyed by tab — each tab gets its own surface, so scroll/edit state
          never bleeds from the previously active tab. data-pane-body lets the
          pointer-drag controller (lib/tabDrag) find this leaf via elementFromPoint. */}
      <div className="pane-body" data-pane-body data-leaf-id={node.id}>
        {!tab && <PaneEmptyState />}
        {tab?.surfaceKind === "note" && <EditorSurface key={tab.id} paneId={node.id} noteId={tab.noteId} />}
        {tab?.surfaceKind === "canvas" && (
          <Suspense fallback={<div className="canvas-surface" />}>
            <CanvasSurface key={tab.id} paneId={node.id} boardId={tab.boardId} />
          </Suspense>
        )}
        {tab?.surfaceKind === "chat" && <ChatSurface key={tab.id} paneId={node.id} chatSlug={tab.chatSlug} />}
        {tab?.surfaceKind === "file" && <FileSurface key={tab.id} paneId={node.id} fileId={tab.fileId} />}
        {tab?.surfaceKind === "activity" && <ActivitySurface key={tab.id} />}
        {/* split-detach preview — mounted only mid-drag, pointer-events:none
            (the controller hit-tests the pane body, not this overlay) */}
        {draggingTab && (
          <div className="pane-dropzones">
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

    // coalesce pointermove into one store write per frame — every write
    // re-renders the whole tree, which stuttered with a canvas pane mounted
    let raf = 0;
    let latest = startPos;
    const onMove = (ev: globalThis.PointerEvent) => {
      latest = node.dir === "row" ? ev.clientX : ev.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const delta = (latest - startPos) / total;
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
      });
    };
    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
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
          title="Drag to resize — double-click to even out"
          onPointerDown={startDrag(i - 1)}
          // Finder/IDE muscle memory: double-click a divider → even split
          onDoubleClick={() =>
            setSplitSizes(
              node.id,
              node.children.map(() => 1 / node.children.length),
            )
          }
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
  // the split floors are enforced at split time — a later window shrink must
  // re-run the fit check (debounced) or flex quietly crushes every column
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refitColumns, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return (
    <div className={multi ? "panes multi" : "panes"}>
      <PaneView node={root} />
    </div>
  );
}
