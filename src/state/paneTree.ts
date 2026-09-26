// The pure walks over the pane tree (split out of panes.ts, 2026-09-26): find
// a leaf, list the leaves, and rebuild the tree with one leaf or every tab
// changed. Pure and total — they never mutate their input.

import type { LeafNode, PaneNode, Tab } from "../types";

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

/** The leaf's active tab — null ONLY for the lone pane after its last tab
 * closed (the quokka empty state; every other leaf always holds tabs). */
export function activeTabOf(leaf: LeafNode): Tab | null {
  return leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0] ?? null;
}

export function updateLeaf(node: PaneNode, id: string, fn: (leaf: LeafNode) => LeafNode): PaneNode {
  if (node.kind === "leaf") return node.id === id ? fn(node) : node;
  return { ...node, children: node.children.map((c) => updateLeaf(c, id, fn)) };
}

/** Map EVERY tab in the tree (all leaves) — for a global retarget like a board
 *  rename, where any open canvas tab's boardId must follow the renamed file. */
export function mapAllTabs(node: PaneNode, fn: (t: Tab) => Tab): PaneNode {
  if (node.kind === "leaf") return { ...node, tabs: node.tabs.map(fn) };
  return { ...node, children: node.children.map((c) => mapAllTabs(c, fn)) };
}
