// Named workspace views are additional hand-arranged projections over Main.
// Main remains the all-items reference tree; each named view stores only a
// subset and its own virtual folders in `.rotli/views.json`. Markdown notes
// also carry `view_tag: <name>` (synchronized by Rust); boards and binary files
// remain frontmatter-free and are represented only by these reference trees.

import type { MenuSpec } from "../state/contextMenu";
import {
  MAIN_ROOT,
  type MainNode,
  addNoteToMainAt,
  gcManifest,
  removeFromMain,
  renameNoteRef,
  uniqueRootFolderName,
} from "./mainTree";

export interface NamedView {
  name: string;
  tree: MainNode[];
  /** Chat slugs belonging to this view (the maintainer, 2026-08-03: "bring the views
   * into the chat area — organize chats by work vs personal"). Additive field:
   * absent reads as none. Chats are files without frontmatter view_tags; this
   * list is their whole view membership, and Rust round-trips it verbatim. */
  chats?: string[];
}

export interface ViewsManifest {
  version: 1;
  views: NamedView[];
}

export interface ParsedViewsManifest {
  manifest: ViewsManifest;
  writable: boolean;
  error: string | null;
}

export const EMPTY_VIEWS: ViewsManifest = { version: 1, views: [] };

export function viewFolderNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a folder name.";
  if (name.includes("/") || name.includes(":")) return "Folder names cannot contain slashes or colons.";
  return null;
}

export function viewNameError(
  value: string,
  existing: readonly NamedView[] = [],
  except?: string,
): string | null {
  const name = value.trim();
  if (!name) return "Enter a view name.";
  if (name.length > 64) return "View names must be 64 characters or fewer.";
  if (name.toLocaleLowerCase() === "main") return "Main is reserved for the all-items view.";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) {
    return "Use letters, numbers, spaces, periods, underscores, or hyphens.";
  }
  const folded = name.toLocaleLowerCase();
  if (existing.some((view) => view.name !== except && view.name.toLocaleLowerCase() === folded)) {
    return "A view with that name already exists.";
  }
  return null;
}

function sanitizeNode(value: unknown): MainNode[] {
  if (!value || typeof value !== "object") return [];
  const node = value as { note?: unknown; folder?: unknown; children?: unknown };
  if (typeof node.note === "string" && node.note.trim()) return [{ note: node.note }];
  if (typeof node.folder !== "string" || !node.folder.trim()) return [];
  return [
    {
      folder: node.folder,
      children: Array.isArray(node.children) ? node.children.flatMap(sanitizeNode) : [],
    },
  ];
}

/** Parse without ever stamping down a future manifest. Unsupported versions
 * render read-only and keep a useful error instead of becoming an empty v1. */
export function parseViewsManifest(raw: string): ParsedViewsManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { manifest: { ...EMPTY_VIEWS }, writable: true, error: "views.json is invalid; using Main only." };
  }
  if (!value || typeof value !== "object") {
    return { manifest: { ...EMPTY_VIEWS }, writable: true, error: "views.json is invalid; using Main only." };
  }
  const record = value as { version?: unknown; views?: unknown };
  if (typeof record.version === "number" && record.version > 1) {
    return {
      manifest: { ...EMPTY_VIEWS },
      writable: false,
      error: `Views were written by a newer Rotli format (v${record.version}); named views are read-only here.`,
    };
  }
  const views: NamedView[] = [];
  if (Array.isArray(record.views)) {
    for (const candidate of record.views) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as { name?: unknown; tree?: unknown };
      if (typeof item.name !== "string" || viewNameError(item.name, views)) continue;
      const chatsRaw = (candidate as { chats?: unknown }).chats;
      const chats = Array.isArray(chatsRaw)
        ? [...new Set(chatsRaw.filter((slug): slug is string => typeof slug === "string" && !!slug.trim()))]
        : [];
      views.push({
        name: item.name.trim(),
        tree: Array.isArray(item.tree) ? item.tree.flatMap(sanitizeNode) : [],
        ...(chats.length > 0 ? { chats } : {}),
      });
    }
  }
  return { manifest: { version: 1, views }, writable: true, error: null };
}

export function serializeViewsManifest(manifest: ViewsManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function viewTree(manifest: ViewsManifest, name: string): MainNode[] {
  return manifest.views.find((view) => view.name === name)?.tree ?? [];
}

export function createNamedView(manifest: ViewsManifest, value: string): ViewsManifest {
  const name = value.trim();
  if (viewNameError(name, manifest.views)) return manifest;
  return { ...manifest, views: [...manifest.views, { name, tree: [] }] };
}

export function renameNamedView(manifest: ViewsManifest, current: string, value: string): ViewsManifest {
  const name = value.trim();
  if (viewNameError(name, manifest.views, current)) return manifest;
  if (name === current || !manifest.views.some((view) => view.name === current)) return manifest;
  return {
    ...manifest,
    views: manifest.views.map((view) => (view.name === current ? { ...view, name } : view)),
  };
}

/** A path-id item was renamed: every view that references it follows, in place. */
export function renameViewItemRef(manifest: ViewsManifest, oldId: string, newId: string): ViewsManifest {
  return {
    ...manifest,
    views: manifest.views.map((view) => ({ ...view, tree: renameNoteRef(view.tree, oldId, newId) })),
  };
}

/** Main's view picker: the exclusive selector (Main + every named view), then
 * New view, then "Delete a view…" as a drill listing every view so any of them
 * can go without switching into it first (items stay in Main; the caller
 * confirms). The shown view additionally gets Rename and its own Delete. */
export function viewPickerItems(
  manifest: ViewsManifest,
  activeView: string | null,
  writable: boolean,
  on: {
    show: (name: string | null) => void;
    create: () => void;
    rename: () => void;
    remove: (name: string) => void;
  },
): MenuSpec[] {
  const items: MenuSpec[] = [
    {
      kind: "action",
      label: "Main — all items",
      checked: activeView === null,
      checkedMark: "highlight",
      onClick: () => on.show(null),
    },
    ...manifest.views.map((view) => ({
      kind: "action" as const,
      label: view.name,
      checked: activeView === view.name,
      checkedMark: "highlight" as const,
      onClick: () => on.show(view.name),
    })),
    { kind: "sep" },
    { kind: "action", label: "New view…", disabled: !writable, onClick: on.create },
    {
      kind: "drill",
      label: "Delete a view…",
      danger: true,
      disabled: !writable || manifest.views.length === 0,
      items: manifest.views.map((view) => ({
        kind: "action" as const,
        label: view.name,
        danger: true,
        onClick: () => on.remove(view.name),
      })),
    },
  ];
  if (activeView) {
    items.push(
      { kind: "action", label: "Rename view…", disabled: !writable, onClick: on.rename },
      {
        kind: "action",
        label: "Delete view…",
        danger: true,
        disabled: !writable,
        onClick: () => on.remove(activeView),
      },
    );
  }
  return items;
}

export function deleteNamedView(manifest: ViewsManifest, name: string): ViewsManifest {
  if (!manifest.views.some((view) => view.name === name)) return manifest;
  return { ...manifest, views: manifest.views.filter((view) => view.name !== name) };
}

// ── chats in views (2026-08-03) ──────────────────────────────────────────────

/** The view a chat belongs to, or null for Main-only. A chat lives in at most
 * one view — the same singular-membership law notes follow. */
export function chatAssignedView(manifest: ViewsManifest, slug: string): string | null {
  return manifest.views.find((view) => view.chats?.includes(slug))?.name ?? null;
}

/** This view's chat slugs ("" / unknown view = none). */
export function viewChats(manifest: ViewsManifest, name: string): readonly string[] {
  return manifest.views.find((view) => view.name === name)?.chats ?? [];
}

/** Assign a chat to a named view (null returns it to Main-only). Enforces
 * singular membership by removing the slug from every other view first. */
export function assignChatToView(
  manifest: ViewsManifest,
  slug: string,
  viewName: string | null,
): ViewsManifest {
  if (viewName !== null && !manifest.views.some((view) => view.name === viewName)) return manifest;
  if (chatAssignedView(manifest, slug) === viewName) return manifest;
  return {
    ...manifest,
    views: manifest.views.map((view) => {
      const kept = (view.chats ?? []).filter((s) => s !== slug);
      const next = view.name === viewName ? [...kept, slug] : kept;
      const { chats: _drop, ...rest } = view;
      return next.length > 0 ? { ...rest, chats: next } : rest;
    }),
  };
}

/** A renamed chat keeps its view — the slug follows in place. */
export function migrateChatViewSlug(
  manifest: ViewsManifest,
  oldSlug: string,
  newSlug: string,
): ViewsManifest {
  if (chatAssignedView(manifest, oldSlug) === null) return manifest;
  return {
    ...manifest,
    views: manifest.views.map((view) =>
      view.chats?.includes(oldSlug)
        ? { ...view, chats: view.chats.map((s) => (s === oldSlug ? newSlug : s)) }
        : view,
    ),
  };
}

export function setNamedViewTree(
  manifest: ViewsManifest,
  name: string,
  tree: MainNode[],
  liveIds?: Set<string>,
): ViewsManifest {
  const cleaned = liveIds ? gcManifest(tree, liveIds) : tree;
  return {
    ...manifest,
    views: manifest.views.map((view) => (view.name === name ? { ...view, tree: cleaned } : view)),
  };
}

/** Singular membership law: an item may belong to one named view. Main is not
 * membership—it remains the global reference view—so assigning never removes
 * the Main reference. */
export function assignItemToView(
  manifest: ViewsManifest,
  itemId: string,
  target: string | null,
  parentId = MAIN_ROOT,
): ViewsManifest {
  const without = manifest.views.map((view) => ({
    ...view,
    tree: removeFromMain(view.tree, itemId),
  }));
  if (target === null) return { ...manifest, views: without };
  return {
    ...manifest,
    views: without.map((view) =>
      view.name === target ? { ...view, tree: addNoteToMainAt(view.tree, itemId, parentId) } : view,
    ),
  };
}

export function assignedView(manifest: ViewsManifest, itemId: string): string | null {
  const contains = (nodes: MainNode[]): boolean =>
    nodes.some((node) => ("note" in node ? node.note === itemId : contains(node.children)));
  return manifest.views.find((view) => contains(view.tree))?.name ?? null;
}

export type ProjectionMenuAction =
  | { kind: "remove-view"; label: string }
  | { kind: "remove-main"; label: "Remove from Main" }
  | { kind: "add-main"; label: "Add to Main" };

/** Keep projection language separate from durable lifecycle language. A row
 * opened inside its assigned named view removes only that view reference;
 * Main continues to use its global add/remove reference action. */
export function projectionMenuAction(
  activeView: string | null,
  assigned: string | null,
  inMain: boolean,
): ProjectionMenuAction {
  if (activeView !== null && assigned === activeView) {
    return { kind: "remove-view", label: `Remove from ${activeView}` };
  }
  return inMain
    ? { kind: "remove-main", label: "Remove from Main" }
    : { kind: "add-main", label: "Add to Main" };
}

function renderedId(node: MainNode, parentId: string): string {
  if ("note" in node) return node.note;
  return parentId === MAIN_ROOT ? `${MAIN_ROOT}${node.folder}` : `${parentId}/${node.folder}`;
}

function findTreeNode(nodes: MainNode[], id: string, parentId = MAIN_ROOT): MainNode | null {
  for (const node of nodes) {
    if (renderedId(node, parentId) === id) return node;
    if ("folder" in node) {
      const found = findTreeNode(node.children, id, renderedId(node, parentId));
      if (found) return found;
    }
  }
  return null;
}

function referencedItems(node: MainNode): string[] {
  if ("note" in node) return [node.note];
  return node.children.flatMap(referencedItems);
}

/** Move/copy one visible tree node into a named view. Moving out of Main is a
 * copy because Main must remain global; moving between named views removes the
 * source. Folder structure is preserved and its Markdown descendants receive
 * the target view_tag through the Rust manifest write. */
export function transferTreeItemToView(
  mainTree: MainNode[],
  manifest: ViewsManifest,
  sourceView: string | null,
  itemId: string,
  targetView: string | null,
): ViewsManifest {
  const sourceTree = sourceView ? viewTree(manifest, sourceView) : mainTree;
  const sourceNode = findTreeNode(sourceTree, itemId);
  if (!sourceNode || sourceView === targetView) return manifest;
  const itemIds = referencedItems(sourceNode);
  let views = manifest.views.map((view) => {
    let tree = sourceView === view.name ? removeFromMain(view.tree, itemId) : view.tree;
    for (const id of itemIds) tree = removeFromMain(tree, id);
    return { ...view, tree };
  });
  if (targetView) {
    views = views.map((view) => {
      if (view.name !== targetView) return view;
      if ("note" in sourceNode) return { ...view, tree: [...view.tree, sourceNode] };
      return {
        ...view,
        tree: [...view.tree, { ...sourceNode, folder: uniqueRootFolderName(view.tree, sourceNode.folder) }],
      };
    });
  }
  return { ...manifest, views };
}
