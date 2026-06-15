// The pane tree (UI state only — the Zustand law). Implements the r2 pane/tab
// law: every pane owns tabs; splits DUPLICATE the active tab (never an empty
// pane); the note list mirrors the focused pane's active tab; plain click
// replaces, only explicit gestures (⌘T / ⌘-click) create tabs. 320px min pane
// width — when a split would break the floor, the folders rail auto-collapses
// first, then the list.
//
// Tab discoverability law (Seth, 2026-06-13): EVERY pane shows its tab strip —
// the old "single-tab pane renders zero chrome" Apple-Notes default is gone,
// so every tab is visible and closeable. Drag-and-drop joins it: tabs reorder
// within a strip (moveTab same-pane), move to another strip (moveTab
// cross-pane), or pull onto a pane edge to carve a new split (detachTab). All
// three ride the same pure/total tree helpers — never mutate inputs.

import { create } from "zustand";
import { initialNoteId, ulid } from "../services/notes";
import type { LeafNode, PaneNode, SplitDir, Tab } from "../types";
import { touchMru } from "./mru";
import { useUiStore } from "./ui";

const MIN_PANE_WIDTH = 320;
const MIN_PANE_HEIGHT = 160;
/** Fallback width when the ui store hasn't seeded one yet — matches ui.ts's
 * sidebarWidth init (Seth, 2026-06-13: one sidebar, not two rails). */
const SIDEBAR_WIDTH = 240;

function makeTab(noteId: string): Tab {
  return { id: ulid(), surfaceKind: "note", noteId, viewState: { cursor: 0, scroll: 0 } };
}

function makeLeaf(tab: Tab): LeafNode {
  return { kind: "leaf", id: ulid(), tabs: [tab], activeTabId: tab.id };
}

// ——— pure tree helpers ———

export function findLeaf(node: PaneNode, id: string): LeafNode | null {
  if (node.kind === "leaf") return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

export function leaves(node: PaneNode, out: LeafNode[] = []): LeafNode[] {
  if (node.kind === "leaf") out.push(node);
  else for (const child of node.children) leaves(child, out);
  return out;
}

export function activeTabOf(leaf: LeafNode): Tab {
  const tab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
  if (!tab) throw new Error("pane with zero tabs");
  return tab;
}

function updateLeaf(node: PaneNode, id: string, fn: (leaf: LeafNode) => LeafNode): PaneNode {
  if (node.kind === "leaf") return node.id === id ? fn(node) : node;
  return { ...node, children: node.children.map((c) => updateLeaf(c, id, fn)) };
}

/** Replace the leaf with a split (or insert a sibling if the parent already
 * splits in the same direction — keeps the tree flat). `before` puts the new
 * leaf on the leading side of the target (left for "row", top for "col");
 * the keyboard split path leaves it false (Seth, 2026-06-13: detach drops
 * onto either edge). */
function splitLeaf(
  node: PaneNode,
  leafId: string,
  dir: SplitDir,
  newLeaf: LeafNode,
  before = false,
): PaneNode {
  if (node.kind === "leaf") {
    if (node.id !== leafId) return node;
    const children = before ? [newLeaf, node] : [node, newLeaf];
    return { kind: "split", id: ulid(), dir, children, sizes: [0.5, 0.5] };
  }
  const index = node.children.findIndex(
    (c) => c.kind === "leaf" && c.id === leafId,
  );
  if (index !== -1 && node.dir === dir) {
    const children = [...node.children];
    const sizes = [...node.sizes];
    const half = (sizes[index] ?? 1 / children.length) / 2;
    sizes.splice(index, 1, half, half);
    children.splice(before ? index : index + 1, 0, newLeaf);
    return { ...node, children, sizes };
  }
  return {
    ...node,
    children: node.children.map((c) => splitLeaf(c, leafId, dir, newLeaf, before)),
  };
}

/** Remove a leaf; collapse single-child splits. Returns null if it was the root. */
function removeLeaf(node: PaneNode, leafId: string): PaneNode | null {
  if (node.kind === "leaf") return node.id === leafId ? null : node;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const kept = removeLeaf(child, leafId);
    if (kept) {
      children.push(kept);
      sizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (children.length === 0) return null;
  const only = children[0];
  if (children.length === 1 && only) return only;
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children, sizes: sizes.map((s) => s / total) };
}

function setSplitSizes(node: PaneNode, splitId: string, sizes: number[]): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSplitSizes(c, splitId, sizes)) };
}

/** How many leaf columns the tree needs side by side (for the 320px floor). */
function columnCount(node: PaneNode): number {
  if (node.kind === "leaf") return 1;
  if (node.dir === "row") return node.children.reduce((sum, c) => sum + columnCount(c), 0);
  return Math.max(...node.children.map(columnCount));
}

/** How many leaf rows the tree stacks (for the 160px height floor). */
function rowCount(node: PaneNode): number {
  if (node.kind === "leaf") return 1;
  if (node.dir === "col") return node.children.reduce((sum, c) => sum + rowCount(c), 0);
  return Math.max(...node.children.map(rowCount));
}

// geometry (unit square) for directional focus
interface LeafRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function leafRects(
  node: PaneNode,
  rect = { x: 0, y: 0, w: 1, h: 1 },
  out: LeafRect[] = [],
): LeafRect[] {
  if (node.kind === "leaf") {
    out.push({ id: node.id, ...rect });
    return out;
  }
  let offset = 0;
  node.children.forEach((child, i) => {
    const size = node.sizes[i] ?? 1 / node.children.length;
    const childRect =
      node.dir === "row"
        ? { x: rect.x + rect.w * offset, y: rect.y, w: rect.w * size, h: rect.h }
        : { x: rect.x, y: rect.y + rect.h * offset, w: rect.w, h: rect.h * size };
    leafRects(child, childRect, out);
    offset += size;
  });
  return out;
}

export type FocusDir = "left" | "right" | "up" | "down";

function neighborIn(root: PaneNode, fromId: string, dir: FocusDir): string | null {
  const rects = leafRects(root);
  const from = rects.find((r) => r.id === fromId);
  if (!from) return null;
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best: { id: string; dist: number } | null = null;
  for (const r of rects) {
    if (r.id === fromId) continue;
    const rx = r.x + r.w / 2;
    const ry = r.y + r.h / 2;
    const dx = rx - cx;
    const dy = ry - cy;
    const inDir =
      (dir === "left" && dx < -0.001 && Math.abs(dx) >= Math.abs(dy)) ||
      (dir === "right" && dx > 0.001 && Math.abs(dx) >= Math.abs(dy)) ||
      (dir === "up" && dy < -0.001 && Math.abs(dy) >= Math.abs(dx)) ||
      (dir === "down" && dy > 0.001 && Math.abs(dy) >= Math.abs(dx));
    if (!inDir) continue;
    const dist = dx * dx + dy * dy;
    if (!best || dist < best.dist) best = { id: r.id, dist };
  }
  return best?.id ?? null;
}

// ——— the store ———

/** The tab currently under an HTML5 drag — set on dragstart, cleared on
 * dragend/drop. Panes read it to arm their split-detach dropzones (Seth,
 * 2026-06-13). */
export interface DraggingTab {
  paneId: string;
  tabId: string;
}

/** Where a detached tab lands relative to its target leaf. */
export type DetachDir = "left" | "right" | "up" | "down";

/** A pane body's 5 drop regions: 4 edges carve a split, center moves here. */
export type DropZone = DetachDir | "center";

/** What the in-flight pointer drag would do if dropped now — drives the strip
 * insertion line and the pane-body zone highlight (Seth, 2026-06-15: the tab
 * drag is pointer-based, not HTML5, so it fires in the macOS WKWebView shell). */
export type DropPreview =
  | { kind: "strip"; paneId: string; index: number }
  | { kind: "zone"; leafId: string; zone: DropZone }
  | null;

interface PanesState {
  root: PaneNode;
  focusedPaneId: string;
  draggingTab: DraggingTab | null;
  /** Live drop target during a pointer drag (null when idle). */
  dropPreview: DropPreview;
  setDropPreview: (preview: DropPreview) => void;
  focusPane: (paneId: string) => void;
  focusDir: (dir: FocusDir) => void;
  /** Plain list click: REPLACE the focused pane's active tab's note.
   * `newTab` (⌘-click / ⌘T path) opens a new tab instead. */
  openNote: (noteId: string, opts?: { newTab?: boolean }) => void;
  newTab: () => void;
  closeTab: () => void;
  closeTabById: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  cycleTab: () => void;
  jumpTab: (index: number) => void;
  lastTab: () => void;
  splitRight: () => void;
  splitDown: () => void;
  closePane: () => void;
  setSplitSizes: (splitId: string, sizes: number[]) => void;
  setDraggingTab: (v: DraggingTab | null) => void;
  /** Reorder within a strip (from === to) or move a tab to another strip,
   * landing at `toIndex`. */
  moveTab: (fromPaneId: string, tabId: string, toPaneId: string, toIndex: number) => void;
  /** Pull a tab into a NEW leaf split off the target's `dir` edge; falls back
   * to moveTab(...end) when the floor won't fit. */
  detachTab: (fromPaneId: string, tabId: string, targetLeafId: string, dir: DetachDir) => void;
}

const initialLeaf = makeLeaf(makeTab(initialNoteId));
touchMru(initialNoteId); // the note the window opens on is the freshest "recent"

/** Before a row split: does one more column fit at the 320px floor?
 * Auto-collapse the ONE sidebar if that's what it takes (Seth, 2026-06-13: the
 * two-rail cascade collapses to a single case) — but only commit the collapse
 * when the split actually fits afterward: a split that cannot fit must not eat
 * the sidebar as a side effect of a no-op. */
function ensureRoomForColumn(root: PaneNode): boolean {
  const columns = columnCount(root) + 1;
  const ui = useUiStore.getState();
  const sidebarWidth = ui.sidebarWidth || SIDEBAR_WIDTH;
  const fitsWith = (sidebarCollapsed: boolean) =>
    window.innerWidth - (sidebarCollapsed ? 0 : sidebarWidth) >= columns * MIN_PANE_WIDTH;
  if (fitsWith(ui.sidebarCollapsed)) return true;
  if (fitsWith(true)) {
    ui.setSidebarCollapsed(true);
    return true;
  }
  return false;
}

export const usePanesStore = create<PanesState>((set, get) => {
  const focusedLeaf = (): LeafNode => {
    const { root, focusedPaneId } = get();
    const leaf = findLeaf(root, focusedPaneId);
    if (leaf) return leaf;
    const first = leaves(root)[0];
    if (!first) throw new Error("pane tree has no leaves");
    return first;
  };

  const split = (dir: SplitDir) => {
    const { root } = get();
    if (dir === "row" && !ensureRoomForColumn(root)) return;
    // the height floor mirrors the divider drag's 160px minimum
    if (dir === "col" && (rowCount(root) + 1) * MIN_PANE_HEIGHT > window.innerHeight) return;
    const leaf = focusedLeaf();
    const dup = makeTab(activeTabOf(leaf).noteId); // duplicate, never empty
    const newLeaf = makeLeaf(dup);
    set({ root: splitLeaf(get().root, leaf.id, dir, newLeaf), focusedPaneId: newLeaf.id });
  };

  /** When a pane closes, focus its geometric NEIGHBOR — never jump to the
   * first leaf across the window. */
  const nextFocusAfterClose = (root: PaneNode, leafId: string): string | null => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      const neighbor = neighborIn(root, leafId, dir);
      if (neighbor) return neighbor;
    }
    return null;
  };

  return {
    root: initialLeaf,
    focusedPaneId: initialLeaf.id,
    draggingTab: null,
    dropPreview: null,
    setDropPreview: (preview) => set({ dropPreview: preview }),

    focusPane: (paneId) => {
      if (findLeaf(get().root, paneId)) set({ focusedPaneId: paneId });
    },

    focusDir: (dir) => {
      const next = neighborIn(get().root, focusedLeaf().id, dir);
      if (next) set({ focusedPaneId: next });
    },

    openNote: (noteId, opts) => {
      touchMru(noteId);
      const leaf = focusedLeaf();
      set({
        root: updateLeaf(get().root, leaf.id, (l) => {
          if (opts?.newTab) {
            const tab = makeTab(noteId);
            return { ...l, tabs: [...l.tabs, tab], activeTabId: tab.id };
          }
          // replace: same tab identity, new surface target, fresh view state
          return {
            ...l,
            tabs: l.tabs.map((t) =>
              t.id === l.activeTabId
                ? { ...t, noteId, viewState: { cursor: 0, scroll: 0 } }
                : t,
            ),
          };
        }),
      });
    },

    newTab: () => {
      const leaf = focusedLeaf();
      get().openNote(activeTabOf(leaf).noteId, { newTab: true });
    },

    closeTab: () => {
      const leaf = focusedLeaf();
      get().closeTabById(leaf.id, leaf.activeTabId);
    },

    closeTabById: (paneId, tabId) => {
      const leaf = findLeaf(get().root, paneId);
      if (!leaf) return;
      if (leaf.tabs.length <= 1) {
        // last tab: closing it closes the pane (unless it's the only pane)
        const neighbor = nextFocusAfterClose(get().root, leaf.id);
        const remaining = removeLeaf(get().root, leaf.id);
        if (!remaining) return;
        const fallback = leaves(remaining)[0];
        if (!fallback) return;
        const focus = neighbor && findLeaf(remaining, neighbor) ? neighbor : fallback.id;
        set({
          root: remaining,
          focusedPaneId:
            get().focusedPaneId === leaf.id ? focus : get().focusedPaneId,
        });
        return;
      }
      set({
        root: updateLeaf(get().root, paneId, (l) => {
          const index = l.tabs.findIndex((t) => t.id === tabId);
          const tabs = l.tabs.filter((t) => t.id !== tabId);
          const nextActive =
            l.activeTabId === tabId
              ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? l.activeTabId)
              : l.activeTabId;
          return { ...l, tabs, activeTabId: nextActive };
        }),
      });
    },

    activateTab: (paneId, tabId) => {
      const target = findLeaf(get().root, paneId)?.tabs.find((t) => t.id === tabId);
      if (target) touchMru(target.noteId);
      set({
        root: updateLeaf(get().root, paneId, (l) =>
          l.tabs.some((t) => t.id === tabId) ? { ...l, activeTabId: tabId } : l,
        ),
        focusedPaneId: paneId,
      });
    },

    cycleTab: () => {
      const leaf = focusedLeaf();
      if (leaf.tabs.length < 2) return;
      const index = leaf.tabs.findIndex((t) => t.id === leaf.activeTabId);
      const next = leaf.tabs[(index + 1) % leaf.tabs.length];
      if (next) get().activateTab(leaf.id, next.id);
    },

    jumpTab: (index) => {
      const leaf = focusedLeaf();
      const tab = leaf.tabs[index];
      if (tab) get().activateTab(leaf.id, tab.id);
    },

    lastTab: () => {
      const leaf = focusedLeaf();
      const tab = leaf.tabs[leaf.tabs.length - 1];
      if (tab) get().activateTab(leaf.id, tab.id);
    },

    splitRight: () => split("row"),
    splitDown: () => split("col"),

    closePane: () => {
      const leaf = focusedLeaf();
      const neighbor = nextFocusAfterClose(get().root, leaf.id);
      const remaining = removeLeaf(get().root, leaf.id);
      if (!remaining) return; // never close the last pane
      const fallback = leaves(remaining)[0];
      if (!fallback) return;
      const focus = neighbor && findLeaf(remaining, neighbor) ? neighbor : fallback.id;
      set({ root: remaining, focusedPaneId: focus });
    },

    setSplitSizes: (splitId, sizes) => {
      set({ root: setSplitSizes(get().root, splitId, sizes) });
    },

    setDraggingTab: (v) => set({ draggingTab: v }),

    moveTab: (fromPaneId, tabId, toPaneId, toIndex) => {
      const root = get().root;
      const from = findLeaf(root, fromPaneId);
      const tab = from?.tabs.find((t) => t.id === tabId);
      if (!from || !tab) return;
      touchMru(tab.noteId);

      if (fromPaneId === toPaneId) {
        // reorder in place: remove, then splice back at the clamped index;
        // activeTabId is identity-stable so it rides along untouched
        set({
          root: updateLeaf(root, fromPaneId, (l) => {
            const without = l.tabs.filter((t) => t.id !== tabId);
            const at = Math.max(0, Math.min(toIndex, without.length));
            const tabs = [...without.slice(0, at), tab, ...without.slice(at)];
            return { ...l, tabs };
          }),
        });
        return;
      }

      // cross-pane: insert a copy into the target (active there), drop from the
      // source, collapse the source if it emptied — all in one tree walk
      let next = updateLeaf(root, toPaneId, (l) => {
        const at = Math.max(0, Math.min(toIndex, l.tabs.length));
        const tabs = [...l.tabs.slice(0, at), tab, ...l.tabs.slice(at)];
        return { ...l, tabs, activeTabId: tab.id };
      });
      const sourceEmpties = from.tabs.length <= 1;
      if (sourceEmpties) {
        const collapsed = removeLeaf(next, fromPaneId);
        if (collapsed) next = collapsed;
      } else {
        next = updateLeaf(next, fromPaneId, (l) => {
          const tabs = l.tabs.filter((t) => t.id !== tabId);
          const index = l.tabs.findIndex((t) => t.id === tabId);
          const activeTabId =
            l.activeTabId === tabId
              ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? l.activeTabId)
              : l.activeTabId;
          return { ...l, tabs, activeTabId };
        });
      }
      set({ root: next, focusedPaneId: toPaneId });
    },

    detachTab: (fromPaneId, tabId, targetLeafId, dir) => {
      const root = get().root;
      const from = findLeaf(root, fromPaneId);
      const tab = from?.tabs.find((t) => t.id === tabId);
      if (!from || !tab) return;
      // pulling a lone tab out of its own pane onto its own edge is a no-op
      if (fromPaneId === targetLeafId && from.tabs.length <= 1) return;

      const splitDir: SplitDir = dir === "left" || dir === "right" ? "row" : "col";
      const before = dir === "left" || dir === "up";

      // floor check on the CURRENT tree (one more column / row must fit); if it
      // can't, fall back to moving the tab to the target strip's end
      const fits =
        splitDir === "row"
          ? ensureRoomForColumn(root)
          : (rowCount(root) + 1) * MIN_PANE_HEIGHT <= window.innerHeight;
      if (!fits) {
        const target = findLeaf(root, targetLeafId);
        get().moveTab(fromPaneId, tabId, targetLeafId, target?.tabs.length ?? 0);
        return;
      }

      // T2: remove the tab from its source first (collapse if it emptied), so
      // the subsequent split targets a tree the tab no longer lives in
      let t2: PaneNode | null;
      if (from.tabs.length <= 1) {
        t2 = removeLeaf(root, fromPaneId);
      } else {
        t2 = updateLeaf(root, fromPaneId, (l) => {
          const tabs = l.tabs.filter((t) => t.id !== tabId);
          const index = l.tabs.findIndex((t) => t.id === tabId);
          const activeTabId =
            l.activeTabId === tabId
              ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? l.activeTabId)
              : l.activeTabId;
          return { ...l, tabs, activeTabId };
        });
      }
      // the source was the whole tree and it emptied — nothing left to split
      if (!t2) return;

      // a fresh single-tab leaf carrying the dragged tab, split off the edge
      const newLeaf: LeafNode = { kind: "leaf", id: ulid(), tabs: [tab], activeTabId: tab.id };
      touchMru(tab.noteId);
      set({
        root: splitLeaf(t2, targetLeafId, splitDir, newLeaf, before),
        focusedPaneId: newLeaf.id,
      });
    },
  };
});

/** The window-level singular list selection: the focused pane's active tab. */
export function useFocusedNoteId(): string | null {
  return usePanesStore((s) => {
    const leaf = findLeaf(s.root, s.focusedPaneId) ?? leaves(s.root)[0];
    if (!leaf) return null;
    const tab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
    return tab?.noteId ?? null;
  });
}
