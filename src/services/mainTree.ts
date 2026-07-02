// Main — the user's hand-arranged view over the Brain (Seth, 2026-07-01; design in
// docs/design/main-brain-daemon.md). Main holds NO files of its own: it's an ordered,
// nested tree of Main-only FOLDERS and note-ID references, stored in `.rotli/main.json`.
// It references notes by `id` only — so when the background daemon refiles a note's
// path in the Brain, its Main slot is untouched ("stays how I set it"). "One file, two
// views": both Main and Brain resolve a row → the same .md by id.
//
// This module is the pure core: parse the manifest, and project it into the synthetic
// { folders, notes } the sidebar's existing renderFolderTree consumes (mirrors
// buildStorageTree). Orphan ids (a note deleted out from under Main) are dropped.

import type { Folder, NoteSummary } from "../types";

/** The Main root marker id — top-level Main folders/notes hang off this (like the
 * "wiki" Brain root or the "Storage" destination). */
export const MAIN_ROOT = "main:";

/** A node in the Main arrangement tree: a Main-only folder (with children) or a
 * reference to a Brain note by its id. */
export type MainNode = { folder: string; children: MainNode[] } | { note: string };

export interface MainManifest {
  version: 1;
  tree: MainNode[];
}

export const EMPTY_MAIN: MainManifest = { version: 1, tree: [] };

/** Parse `.rotli/main.json` defensively — a corrupt/absent manifest means an empty
 * Main, never a crash (mirrors persist.ts's tolerant parsing). */
export function parseMainManifest(raw: string): MainManifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...EMPTY_MAIN };
  }
  if (typeof data !== "object" || data === null) return { ...EMPTY_MAIN };
  const tree = (data as { tree?: unknown }).tree;
  return { version: 1, tree: Array.isArray(tree) ? tree.flatMap(sanitizeNode) : [] };
}

/** Keep only well-formed nodes (drop anything that isn't a proper folder/note). */
function sanitizeNode(node: unknown): MainNode[] {
  if (typeof node !== "object" || node === null) return [];
  if (typeof (node as { note?: unknown }).note === "string") {
    return [{ note: (node as { note: string }).note }];
  }
  const folder = (node as { folder?: unknown }).folder;
  if (typeof folder === "string" && folder.trim()) {
    const kids = (node as { children?: unknown }).children;
    return [{ folder, children: Array.isArray(kids) ? kids.flatMap(sanitizeNode) : [] }];
  }
  return [];
}

/** Serialize back to JSON for `.rotli/main.json`. */
export function serializeMainManifest(m: MainManifest): string {
  return JSON.stringify({ version: 1, tree: m.tree }, null, 2);
}

/** Project the manifest into synthetic sidebar rows: Main-only folders (ids
 * "main:<path>") + the referenced notes re-homed to their Main folder, IN MANIFEST
 * ORDER. Notes whose id no longer exists are dropped (orphan GC). The returned notes
 * carry an `order` you can sort by (the sidebar's default pinned→updated sort is wrong
 * for a hand-arranged view). */
export function buildMainTree(
  tree: MainNode[],
  notesById: Map<string, NoteSummary>,
): { folders: Folder[]; notes: (NoteSummary & { mainOrder: number })[] } {
  const folders: Folder[] = [];
  const notes: (NoteSummary & { mainOrder: number })[] = [];
  let order = 0;
  const walk = (nodes: MainNode[], parentId: string) => {
    for (const node of nodes) {
      if ("folder" in node) {
        const id = parentId === MAIN_ROOT ? `${MAIN_ROOT}${node.folder}` : `${parentId}/${node.folder}`;
        folders.push({ id, name: node.folder, parentId });
        walk(node.children, id);
      } else {
        const n = notesById.get(node.note);
        if (n) notes.push({ ...n, folderId: parentId, mainOrder: order++ });
      }
    }
  };
  walk(tree, MAIN_ROOT);
  return { folders, notes };
}

/** Prune manifest note-refs whose id no longer exists (called on save so the file
 * doesn't accumulate dead ids). Empty folders are KEPT — an empty folder is a valid
 * "made it, will fill it later" gesture. */
export function gcManifest(tree: MainNode[], liveIds: Set<string>): MainNode[] {
  return tree.flatMap((node): MainNode[] => {
    if ("folder" in node) return [{ folder: node.folder, children: gcManifest(node.children, liveIds) }];
    return liveIds.has(node.note) ? [node] : [];
  });
}

// ─── tree mutations (drag-drop + add/remove), all pure + immutable ──────────────

export type DropPos = "before" | "after" | "into";

/** The rendered row id of a node — a note id, or a folder's "main:<path>" id (must
 * match buildMainTree's ids exactly, so drag targets line up with rendered rows). */
function idOf(node: MainNode, parentId: string): string {
  if ("note" in node) return node.note;
  return parentId === MAIN_ROOT ? `${MAIN_ROOT}${node.folder}` : `${parentId}/${node.folder}`;
}

/** True when `noteId` is referenced anywhere in the Main tree (used by the
 * context menu to toggle Add ↔ Remove from Main). */
export function mainHasNote(nodes: MainNode[], noteId: string): boolean {
  return containsNote(nodes, noteId);
}

/** Every note id referenced anywhere in Main, as a Set — the O(1) "is this note
 * curated?" lookup the Captures filter uses (a note placed in Main is a full
 * note the user keeps, not a passing capture). */
export function mainNoteIds(nodes: MainNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (ns: MainNode[]) => {
    for (const n of ns) {
      if ("note" in n) ids.add(n.note);
      else walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

function containsNote(nodes: MainNode[], noteId: string): boolean {
  return nodes.some((n) => ("note" in n ? n.note === noteId : containsNote(n.children, noteId)));
}

function findAndRemove(
  nodes: MainNode[],
  dragId: string,
  parentId: string,
): { tree: MainNode[]; node: MainNode | null } {
  const out: MainNode[] = [];
  let node: MainNode | null = null;
  for (const n of nodes) {
    if (idOf(n, parentId) === dragId) {
      node = n;
      continue;
    }
    if ("folder" in n) {
      const r = findAndRemove(n.children, dragId, idOf(n, parentId));
      if (r.node) node = r.node;
      out.push({ folder: n.folder, children: r.tree });
    } else {
      out.push(n);
    }
  }
  return { tree: out, node };
}

function insertById(
  nodes: MainNode[],
  node: MainNode,
  targetId: string,
  pos: DropPos,
  parentId: string,
): { tree: MainNode[]; found: boolean } {
  const out: MainNode[] = [];
  let found = false;
  for (const n of nodes) {
    const id = idOf(n, parentId);
    if (id === targetId && pos === "before") {
      out.push(node);
      found = true;
    }
    if (id === targetId && pos === "into" && "folder" in n) {
      out.push({ folder: n.folder, children: [node, ...n.children] });
      found = true;
    } else if ("folder" in n) {
      const r = insertById(n.children, node, targetId, pos, id);
      out.push({ folder: n.folder, children: r.tree });
      if (r.found) found = true;
    } else {
      out.push(n);
    }
    if (id === targetId && pos === "after") {
      out.push(node);
      found = true;
    }
  }
  return { tree: out, found };
}

/** Move a note/folder (by its rendered id) to before/after a sibling or into a
 * folder. No-ops if the drag would vanish the target (dropping a folder into its own
 * subtree) or the target isn't found. */
export function moveInTree(tree: MainNode[], dragId: string, targetId: string, pos: DropPos): MainNode[] {
  if (dragId === targetId) return tree;
  const { tree: without, node } = findAndRemove(tree, dragId, MAIN_ROOT);
  if (!node) return tree;
  if (targetId === MAIN_ROOT) return [...without, node]; // drop at the Main root
  const r = insertById(without, node, targetId, pos, MAIN_ROOT);
  return r.found ? r.tree : tree;
}

/** Add a note to the Main root (a no-op if it's already anywhere in Main). */
export function addNoteToMain(tree: MainNode[], noteId: string): MainNode[] {
  return containsNote(tree, noteId) ? tree : [...tree, { note: noteId }];
}

/** Append a new empty Main folder at the root. The name uniquifies against its
 * root siblings ("New folder" → "New folder 2") because a root folder's rendered
 * id IS "main:<name>" — twins would collide as React keys / drag targets. */
export function addFolderToMain(tree: MainNode[], name: string): MainNode[] {
  const taken = new Set(tree.flatMap((n) => ("folder" in n ? [n.folder] : [])));
  let unique = name;
  for (let i = 2; taken.has(unique); i++) unique = `${name} ${i}`;
  return [...tree, { folder: unique, children: [] }];
}

/** Remove a note/folder from Main by its rendered id (a folder takes its subtree). */
export function removeFromMain(tree: MainNode[], dragId: string): MainNode[] {
  return findAndRemove(tree, dragId, MAIN_ROOT).tree;
}
