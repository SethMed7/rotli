// The pane tree. EVERY leaf renders its tab strip now (the maintainer, 2026-06-13) — the
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
  useState,
} from "react";

import { EditorSurface } from "../editor/editorSurface";
import { evictDocument, pendingNoteDocumentId } from "../editor/model";
import { dispatch } from "../keys/registry";
import {
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  activeTabOf,
  clampSplitSizes,
  leaves,
  refitColumns,
  usePanesStore,
} from "../state/panes";
import { isWarmSurface, nextWarmSurfaceIds } from "../state/paneWarmth";
import type { LeafNode, PaneNode, SplitNode } from "../types";
import { ActivitySurface } from "./activitySurface";
import { BrowserSurface } from "./browserSurface";
import { Character } from "./character";
import { ChatSurface } from "./chat/chatSurface";
import { FileSurface } from "./fileSurface";
import { NewItemSurface } from "./newItemSurface";
import { TabStrip } from "./tabStrip";

// Excalidraw is heavy (~3.5MB with its mermaid/katex deps) and most sessions
// never open a board — code-split it so it loads only when a canvas tab mounts,
// keeping the main bundle lean (the maintainer, 2026-06-24).
const CanvasSurface = lazy(() => import("./canvasSurface").then((m) => ({ default: m.CanvasSurface })));

/** All tabs closed (only possible in the lone pane) — the quokka rest state
 * (the maintainer, 2026-07-28: "close all tabs and have an empty state"). Quiet, with
 * the three ways back in. */
function PaneEmptyState() {
  return (
    <div className="list-empty pane-empty">
      <Character name="base" size={120} className="be-quokka" accessorized />
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
          <kbd>⌘⌥T</kbd> reopen tab
        </button>
      </p>
    </div>
  );
}

function PendingNoteSurface({ paneId, tabId }: { paneId: string; tabId: string }) {
  const noteId = pendingNoteDocumentId(tabId);
  useEffect(
    () => () => {
      // StrictMode performs a setup/cleanup probe while the tab still exists.
      // Defer the orphan check so only a real close/retarget releases the
      // session buffer (retarget already adopted it under the durable id).
      queueMicrotask(() => {
        const state = usePanesStore.getState();
        const stillPending = leaves(state.root).some((leaf) =>
          leaf.tabs.some(
            (tab) => tab.id === tabId && tab.surfaceKind === "newItem" && tab.pendingNote === true,
          ),
        );
        if (!stillPending) evictDocument(noteId);
      });
    },
    [noteId, tabId],
  );
  return <EditorSurface noteId={noteId} paneId={paneId} pending focusOnMount />;
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
  const [warmSurfaceIds, setWarmSurfaceIds] = useState<string[]>([]);
  useEffect(() => {
    setWarmSurfaceIds((current) => nextWarmSurfaceIds(current, tab, node.tabs));
  }, [node.tabs, tab]);
  const mountedHeavyIds = new Set([...warmSurfaceIds, ...(tab && isWarmSurface(tab) ? [tab.id] : [])]);
  const mountedHeavyTabs = node.tabs.filter((candidate) => mountedHeavyIds.has(candidate.id));

  // `focused` drives two cues, both multi-pane only (the lone pane has nowhere
  // else to be), both drawn in CSS off the `focused` class — that class is the
  // DOM marker for "you are here" and is load-bearing, not decoration:
  //   · the resident ring — a 1px accent frame that stays for as long as this
  //     pane holds focus (the maintainer, 2026-08-01), `.panes.multi .pane.focused::before`
  //   · the landing light — the same frame at 2px, flashed once on ARRIVAL
  //     (the maintainer, 2026-07-30: hotkey pane-focus "needs some sort of quick visual
  //     highlight"), gated by the `flash` state below
  const focused = node.id === focusedPaneId;
  const multi = usePanesStore((s) => s.root.kind === "split");
  const [flash, setFlash] = useState(false);
  // starts FALSE on purpose: a pane BORN focused (open-to-the-side carves one)
  // is exactly the "where am I now" moment and must flash too
  const prevFocused = useRef(false);
  useEffect(() => {
    const was = prevFocused.current;
    prevFocused.current = focused;
    if (!focused || was || !multi) return;
    setFlash(true);
  }, [focused, multi]);
  // the fade timer keys off `flash` in its own effect — StrictMode's double
  // mount re-arms it cleanly (the combined effect lost its timer to the ref
  // mutation on the second pass and the light never faded)
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <section
      className={`pane${focused ? " focused" : ""}${flash ? " focus-flash" : ""}`}
      onMouseDownCapture={() => focusPane(node.id)}
    >
      <TabStrip pane={node} />
      {/* keyed by tab — each tab gets its own surface, so scroll/edit state
          never bleeds from the previously active tab. data-pane-body lets the
          pointer-drag controller (lib/tabDrag) find this leaf via elementFromPoint. */}
      <div className="pane-body" data-pane-body data-leaf-id={node.id}>
        {!tab && <PaneEmptyState />}
        {tab?.surfaceKind === "note" &&
          (tab.noteId ? (
            <EditorSurface
              key={tab.id}
              paneId={node.id}
              noteId={tab.noteId}
              {...(tab.focusOnMount ? { focusOnMount: true } : {})}
            />
          ) : (
            <PaneEmptyState />
          ))}
        {mountedHeavyTabs.map((heavyTab) => {
          const active = heavyTab.id === tab?.id;
          return (
            <div
              key={heavyTab.id}
              className={active ? "pane-surface-slot active" : "pane-surface-slot idle"}
              aria-hidden={!active}
              inert={!active}
            >
              {heavyTab.surfaceKind === "canvas" && (
                <Suspense fallback={<div className="canvas-surface" />}>
                  <CanvasSurface paneId={node.id} boardId={heavyTab.boardId} />
                </Suspense>
              )}
              {heavyTab.surfaceKind === "chat" && (
                <ChatSurface
                  paneId={node.id}
                  tabId={heavyTab.id}
                  chatSlug={heavyTab.chatSlug}
                  {...(heavyTab.vaultId ? { vaultId: heavyTab.vaultId } : {})}
                />
              )}
              {heavyTab.surfaceKind === "file" && <FileSurface paneId={node.id} fileId={heavyTab.fileId} />}
              {heavyTab.surfaceKind === "browser" && (
                <BrowserSurface paneId={node.id} tabId={heavyTab.id} active={active} />
              )}
            </div>
          );
        })}
        {tab?.surfaceKind === "activity" && <ActivitySurface key={tab.id} />}
        {tab?.surfaceKind === "newItem" &&
          (tab.pendingNote ? (
            <PendingNoteSurface key={tab.id} paneId={node.id} tabId={tab.id} />
          ) : tab.pendingLabel ? (
            <div key={tab.id} className="editor" role="status" aria-label={`Creating ${tab.pendingLabel}`} />
          ) : (
            <NewItemSurface key={tab.id} paneId={node.id} tabId={tab.id} />
          ))}
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

/** A split's per-child floor, as a fraction of its REAL box — never more than an
 * even share, or a container already smaller than the floor would refuse to
 * resize at all. Width and height carry different floors (a column needs room
 * for a note's measure; a row needs room for a surface's fixed chrome). */
function minFracOf(node: SplitNode, total: number): number {
  const floorPx = node.dir === "row" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  return Math.min(floorPx / total, 1 / node.children.length);
}

function SplitView({ node }: { node: SplitNode }) {
  const setSplitSizes = usePanesStore((s) => s.setSplitSizes);
  const containerRef = useRef<HTMLDivElement>(null);
  // The live re-fit, the maintainer 2026-08-01: the floors used to be enforced only at
  // split time and during a drag, so shrinking the window — or the sidebar, or
  // a parent split — quietly crushed a pane past the point where its own chrome
  // fits, and surfaces started painting into the pane next door. The observer
  // watches the split's real box and re-applies the ONE size law.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const total = node.dir === "row" ? rect.width : rect.height;
      if (total <= 0) return;
      const current = node.children.map((_, i) => node.sizes[i] ?? 1 / node.children.length);
      const fitted = clampSplitSizes(current, minFracOf(node, total));
      if (fitted.every((s, i) => Math.abs(s - (current[i] ?? 0)) < 0.001)) return;
      setSplitSizes(node.id, fitted);
    });
    observer.observe(container);
    return () => observer.disconnect();
    // the tree object is replaced on every store write, so the observer always
    // closes over the current sizes
  }, [node, setSplitSizes]);

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
    const minFrac = minFracOf(node, total);
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
          // aria-label, NOT title (the maintainer, 2026-08-01): a native tooltip on the
          // one element you hover while judging a layout parks a yellow slab
          // over the very content you are sizing. The resize cursor and the
          // accent line the divider lights on hover already say "drag me".
          aria-label="Drag to resize — double-click to even out"
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
