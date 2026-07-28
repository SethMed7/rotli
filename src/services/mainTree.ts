// Main — the user's hand-arranged view over the Brain (Seth, 2026-07-01; design in
// memex-vault wiki/projects/rotli/main-brain-daemon.md). Main holds NO files of its own: it's an ordered,
// nested tree of Main-only FOLDERS and note-ID references, stored in `.rotli/main.json`.
// It references notes by `id` only — so when the background daemon refiles a note's
// path in the Brain, its Main slot is untouched ("stays how I set it"). "One file, two
// views": both Main and Brain resolve a row → the same .md by id.
//
// This module is the pure core: parse the manifest, and project it into the synthetic
// { folders, notes } the sidebar's existing renderFolderTree consumes (mirrors
// buildStorageTree). Orphan ids (a note deleted out from under Main) are dropped.

import { isSink, isVault } from "./destinations";
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
        // RENDER only refs whose real home is Main-eligible. A note moved to a
        // sink (Archive/Trash) or living in the external Vault keeps its manifest
        // slot — so it survives GC (which uses the FULL index) — but must not show
        // as a live Main row (Seth, 2026-07-08: "if it's not in the Brain or
        // Storage, Main shouldn't have it"). Board/Storage/wiki homes pass.
        if (n && !isSink(n.folderId) && !isVault(n.folderId)) {
          notes.push({ ...n, folderId: parentId, mainOrder: order++ });
        }
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

/** Every synthetic Main FOLDER id ("main:<path>", buildMainTree's exact
 * grammar) — the ids the sidebar keys expansion state under. Collapse-all
 * writes these explicitly closed (Main folders default OPEN, so wiping the
 * map re-expanded them — #83, audit 2026-07), and the persisted-map GC keeps
 * only these among "main:*" keys (#78). */
/** The ONE Main row comparator: pinned notes FLOAT above the hand-arranged
 * order (Seth, 2026-07-09), the manifest itself is never reordered. Both the
 * renderer and the roving j/k walk MUST use this — they diverged once and the
 * keyboard cursor visibly teleported (P0 sweep 2026-07-28). */
export function mainRowSort(
  a: { pinned: boolean; mainOrder: number },
  b: { pinned: boolean; mainOrder: number },
): number {
  return Number(b.pinned) - Number(a.pinned) || a.mainOrder - b.mainOrder;
}

export function mainFolderIds(nodes: MainNode[]): string[] {
  const ids: string[] = [];
  const walk = (ns: MainNode[], parentId: string) => {
    for (const n of ns) {
      if ("folder" in n) {
        const id = parentId === MAIN_ROOT ? `${MAIN_ROOT}${n.folder}` : `${parentId}/${n.folder}`;
        ids.push(id);
        walk(n.children, id);
      }
    }
  };
  walk(nodes, MAIN_ROOT);
  return ids;
}

/** Durable item ids contained by one rendered Main/view folder, including its
 * nested virtual folders. The folder itself is only a projection; lifecycle
 * actions operate on these referenced files and then remove the empty virtual
 * container. Missing ids return an empty list and duplicate refs collapse. */
export function mainItemIdsInFolder(nodes: MainNode[], folderId: string): string[] {
  const collect = (node: MainNode): string[] =>
    "note" in node ? [node.note] : node.children.flatMap(collect);
  const find = (items: MainNode[], parentId: string): string[] | null => {
    for (const node of items) {
      if (!("folder" in node)) continue;
      const id = idOf(node, parentId);
      if (id === folderId) return collect(node);
      const nested = find(node.children, id);
      if (nested) return nested;
    }
    return null;
  };
  return [...new Set(find(nodes, MAIN_ROOT) ?? [])];
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

/** Add a note INTO the Main folder with rendered id `parentId` ("main:<path>"),
 * or the Main root when `parentId` is MAIN_ROOT / the folder can't be found.
 * A no-op if the note already lives anywhere in Main. Every new note lands in
 * Main, inside the folder the user is working in (Seth #15/#16, 2026-07-03). */
export function addNoteToMainAt(tree: MainNode[], noteId: string, parentId: string): MainNode[] {
  if (containsNote(tree, noteId)) return tree;
  const ref: MainNode = { note: noteId };
  if (parentId === MAIN_ROOT) return [...tree, ref];
  let found = false;
  const walk = (nodes: MainNode[], pid: string): MainNode[] =>
    nodes.map((n) => {
      if (!("folder" in n)) return n;
      const id = idOf(n, pid);
      if (id === parentId) {
        found = true;
        return { folder: n.folder, children: [...n.children, ref] };
      }
      return { folder: n.folder, children: walk(n.children, id) };
    });
  const next = walk(tree, MAIN_ROOT);
  return found ? next : [...tree, ref]; // folder vanished → land at the root
}

/** The rendered id of the Main folder that DIRECTLY contains `noteId` — MAIN_ROOT
 * when it sits at the top level, or null when the note isn't in Main at all. Lets
 * a new note inherit the current note's Main folder (#16). */
export function mainParentOfNote(tree: MainNode[], noteId: string): string | null {
  const walk = (nodes: MainNode[], parentId: string): string | null => {
    for (const n of nodes) {
      if ("note" in n) {
        if (n.note === noteId) return parentId;
      } else {
        const hit = walk(n.children, idOf(n, parentId));
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(tree, MAIN_ROOT);
}

/** The uniquified name a new root folder will take — the exact collision law
 * addFolderToMain applies ("New folder" → "New folder 2"), exported so the UI
 * can compute the folder's rendered id ("main:<name>") and scroll/focus the
 * fresh row after the commit (it's appended after every root note, which made
 * a new folder easy to lose). */
export function uniqueRootFolderName(tree: MainNode[], name: string): string {
  const taken = new Set(tree.flatMap((n) => ("folder" in n ? [n.folder] : [])));
  let unique = name;
  for (let i = 2; taken.has(unique); i++) unique = `${name} ${i}`;
  return unique;
}

/** Append a new empty Main folder at the root. The name uniquifies against its
 * root siblings ("New folder" → "New folder 2") because a root folder's rendered
 * id IS "main:<name>" — twins would collide as React keys / drag targets. */
export function addFolderToMain(tree: MainNode[], name: string): MainNode[] {
  return [...tree, { folder: uniqueRootFolderName(tree, name), children: [] }];
}

/** Remove a note/folder from Main by its rendered id (a folder takes its subtree). */
export function removeFromMain(tree: MainNode[], dragId: string): MainNode[] {
  return findAndRemove(tree, dragId, MAIN_ROOT).tree;
}

/** Rename a Main folder by its rendered id ("main:<path>"). The new name
 * uniquifies against its SIBLING folders (addFolderToMain's collision law —
 * twins would collide as React keys / drag targets); children, order and
 * nesting are untouched. Descendant rendered ids change with the path, so
 * their expansion state falls back to the open default — cosmetic. No-op on
 * an empty name or an id that isn't in the tree (#16, audit 2026-07). */
export function renameFolderInMain(tree: MainNode[], folderId: string, name: string): MainNode[] {
  const trimmed = name.trim();
  if (!trimmed) return tree;
  const walk = (nodes: MainNode[], parentId: string): MainNode[] => {
    const here = nodes.some((n) => "folder" in n && idOf(n, parentId) === folderId);
    if (!here) {
      return nodes.map((n) =>
        "folder" in n ? { folder: n.folder, children: walk(n.children, idOf(n, parentId)) } : n,
      );
    }
    const taken = new Set(
      nodes.flatMap((n) => ("folder" in n && idOf(n, parentId) !== folderId ? [n.folder] : [])),
    );
    let unique = trimmed;
    for (let i = 2; taken.has(unique); i++) unique = `${trimmed} ${i}`;
    return nodes.map((n) =>
      "folder" in n && idOf(n, parentId) === folderId ? { folder: unique, children: n.children } : n,
    );
  };
  return walk(tree, MAIN_ROOT);
}

/** Retarget a note ref in place — board (and file) ids ARE paths, so a rename
 * mints a NEW id; without this the next setTree GC'd the committed Main slot
 * (#33, audit 2026-07). Position/nesting are preserved exactly (a rename must
 * never move the row the user placed). No-op when oldId isn't referenced. */
export function renameNoteRef(tree: MainNode[], oldId: string, newId: string): MainNode[] {
  return tree.map((node) => {
    if ("note" in node) return node.note === oldId ? { note: newId } : node;
    return { folder: node.folder, children: renameNoteRef(node.children, oldId, newId) };
  });
}
