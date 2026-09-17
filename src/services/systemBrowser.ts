// The System browser (Finder rework 2026-07-27, from the maintainer's screenshots): the
// browser is SPATIAL, exactly like a traditional Finder — you are IN one
// folder and see only its direct contents: subfolders rendered as folders,
// notes as items. You enter a folder to descend, climb back by breadcrumb.
// "Folders" is the icon-grid view; "List" is the columned list (Name · Date
// Modified · Kind). This module is the pure part; the surface renders.

import { noteDiskFolder } from "../lib/noteLocation";
import type { NoteSummary } from "../types";
import { isChatsPath } from "./destinations";

export type SystemViewMode = "folders" | "list" | "columns" | "gallery";
export type SystemSortKey = "name" | "date" | "kind" | "created";

/** One subfolder of the current directory, as Finder would show it. */
export interface FolderEntry {
  /** Full folder path ("wiki/Projects"). */
  path: string;
  /** Humanized display name of the LAST segment ("Projects", "Secure notes"). */
  name: string;
  /** Notes anywhere under the subtree (the quiet count beside the name). */
  itemCount: number;
  /** The subtree's freshest item — Finder's Date Modified; null when empty. */
  updatedAt: number | null;
}

/** A directory's direct contents: subfolders + the notes sitting right here. */
export interface FolderListing {
  folders: FolderEntry[];
  items: NoteSummary[];
}

/** Humanize one folder segment — internal names get their display names. */
export function folderSegmentLabel(seg: string): string {
  if (seg === "_secure") return "Secure notes";
  if (seg === "_inbox") return "Captures";
  if (seg === "Storage") return "Assets";
  if (seg === "chats") return "Chats";
  return seg;
}

/** The Library's SYSTEM LANES — real directories that are NOT browsable
 * knowledge areas, hidden from the Library grid (the maintainer, 2026-07-30: they
 * rendered as broken-looking empty tiles). `wiki/_inbox` is the capture
 * staging lane whose notes surface through the Captures front (sidebar +
 * board); `wiki/_templates` is contract-owned machine plumbing (the chat
 * template lives there; the organizer skips it like _inbox). Neither is
 * deletable through rotli — the memex write guard owns them. */
export const LIBRARY_HIDDEN_LANES: ReadonlySet<string> = new Set(["wiki/_inbox", "wiki/_templates"]);

/** pinned float first, then most-recently touched — search-result order. */
function sortByRecency(items: NoteSummary[]): NoteSummary[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** The instant search filter (title + snippet, case-insensitive) — search
 * flattens across the whole root, like Finder's own search. */
export function filterSystemItems(items: NoteSummary[], query: string): NoteSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sortByRecency(items);
  return sortByRecency(
    items.filter((n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q)),
  );
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Every folder under the root, from the notes' on-disk paths (each ancestor)
 * plus the seeded real directories, minus the hidden lanes. */
function allFolders(
  items: NoteSummary[],
  seedFolders: readonly string[],
  pathOf: (n: NoteSummary) => string,
  hidden: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  const add = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const folder = parts.slice(0, depth).join("/");
      if (!hidden.has(folder)) out.add(folder);
    }
  };
  for (const n of items) add(pathOf(n));
  for (const seed of seedFolders) add(seed);
  return [...out];
}

/** The Library's search, for folders: every folder anywhere under the root
 * whose own name contains the query (the owner, 2026-09-16: "engineering"
 * never came up for "Engineering" — only its notes did). */
export function filterSystemFolders(
  items: NoteSummary[],
  query: string,
  seedFolders: readonly string[] = [],
  pathOf: (n: NoteSummary) => string = noteDiskFolder,
  hidden: ReadonlySet<string> = new Set(),
): FolderEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return allFolders(items, seedFolders, pathOf, hidden)
    .map((path) => ({ path, name: folderSegmentLabel(path.slice(path.lastIndexOf("/") + 1)) }))
    .filter(({ name }) => name.toLowerCase().includes(q))
    .sort((a, b) => byName(a.name, b.name))
    .map(({ path, name }) => {
      const inside = items.filter((n) => {
        const p = pathOf(n);
        return p === path || p.startsWith(`${path}/`);
      });
      return {
        path,
        name,
        itemCount: inside.length,
        updatedAt: inside.length ? Math.max(...inside.map((n) => n.updatedAt)) : null,
      };
    });
}

/** Map a note's ON-DISK folder path into the browser root's namespace. In a
 * memex the projection renames lifecycle lanes (disk `storage/…` surfaces as
 * destination "Storage") while `diskFolderId` keeps the on-disk lowercase —
 * comparing them raw made the Assets/Archive/Trash browsers read as empty
 * beside a real count (the maintainer, 2026-07-28: "Assets shows empty but a count of
 * 422"). A path already under the prefix passes through; a case-twin first
 * segment re-roots onto the prefix; anything else surfaces AT the root
 * rather than vanishing. */
export function rerootDiskPath(path: string, rootPrefix: string): string {
  if (path === rootPrefix || path.startsWith(`${rootPrefix}/`)) return path;
  const first = path.split("/")[0] ?? "";
  if (first.toLowerCase() === rootPrefix.toLowerCase()) return rootPrefix + path.slice(first.length);
  return rootPrefix;
}

/** The direct child of `cwd` that `path` sits under, or null. */
function childOf(cwd: string, path: string): string | null {
  if (!path.startsWith(`${cwd}/`)) return null;
  const rest = path.slice(cwd.length + 1);
  const seg = rest.split("/")[0];
  return seg ? `${cwd}/${seg}` : null;
}

/** A directory's direct contents. Subfolders derive from every item's real
 * disk folder UNION the seeded directory paths (so an EMPTY directory is
 * still a real folder — hiding it reads as data loss). Finder's default
 * order: folders and items each name-ascending. `pathOf` lets a surface remap
 * each item's disk path into its root namespace (rerootDiskPath). */
export function listFolderContents(
  items: NoteSummary[],
  cwd: string,
  seedFolders: readonly string[] = [],
  pathOf: (n: NoteSummary) => string = noteDiskFolder,
  hidden: ReadonlySet<string> = new Set(),
): FolderListing {
  const children = new Set<string>();
  const direct: NoteSummary[] = [];
  for (const n of items) {
    const path = pathOf(n);
    if (path === cwd) {
      direct.push(n);
      continue;
    }
    const child = childOf(cwd, path);
    if (child && !hidden.has(child)) children.add(child);
  }
  for (const seed of seedFolders) {
    if (seed === cwd) continue;
    const child = childOf(cwd, seed);
    if (child && !hidden.has(child)) children.add(child);
  }
  const folders = [...children].sort(byName).map((path) => {
    const inside = items.filter((n) => {
      const p = pathOf(n);
      return p === path || p.startsWith(`${path}/`);
    });
    return {
      path,
      name: folderSegmentLabel(path.slice(path.lastIndexOf("/") + 1)),
      itemCount: inside.length,
      updatedAt: inside.length ? Math.max(...inside.map((n) => n.updatedAt)) : null,
    };
  });
  const sortedItems = [...direct].sort((a, b) => byName(a.title, b.title));
  return { folders, items: sortedItems };
}

/** Re-order a listing by a Finder column. Folders and items sort within their
 * own bands (folders never interleave with items — the list view's grammar).
 * Folders are all one Kind and carry no created stamp, so those keys fall back
 * to date-modified / name for the folder band. */
export function sortFolderListing(l: FolderListing, key: SystemSortKey, dir: 1 | -1): FolderListing {
  const folders = [...l.folders].sort((a, b) => {
    if (key === "name" || key === "kind") return dir * byName(a.name, b.name);
    return dir * ((a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  });
  const items = [...l.items].sort((a, b) => {
    if (key === "name") return dir * byName(a.title, b.title);
    if (key === "kind") return dir * (byName(kindLabel(a), kindLabel(b)) || byName(a.title, b.title));
    if (key === "created") return dir * (a.createdAt - b.createdAt);
    return dir * (a.updatedAt - b.updatedAt);
  });
  return { folders, items };
}

/** The clickable path trail ("Library › Projects › rotli") — the root crumb
 * carries the browser's title; each crumb keeps its full path for navigation. */
export function breadcrumbOf(
  cwd: string,
  rootPrefix: string,
  rootTitle: string,
): { path: string; label: string }[] {
  const crumbs = [{ path: rootPrefix, label: rootTitle }];
  if (cwd === rootPrefix) return crumbs;
  const rel = cwd.startsWith(`${rootPrefix}/`) ? cwd.slice(rootPrefix.length + 1) : cwd;
  let path = rootPrefix;
  for (const seg of rel.split("/")) {
    path = `${path}/${seg}`;
    crumbs.push({ path, label: folderSegmentLabel(seg) });
  }
  return crumbs;
}

/** Finder's Kind column — extension-aware for files (the maintainer, 2026-07-28:
 * "show file type"), so a PDF says PDF, not the useless "File". */
const FILE_KINDS: Record<string, string> = {
  pdf: "PDF",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  webp: "WebP image",
  svg: "SVG image",
  csv: "CSV spreadsheet",
  xlsx: "Spreadsheet",
  docx: "Document",
  md: "Markdown",
  txt: "Plain text",
  mp3: "Audio",
  m4a: "Audio",
  wav: "Audio",
  mp4: "Video",
  mov: "Video",
};

/** A chat transcript surfaced through the Library (`chats/<slug>.md`): the
 * owner's law is that the Library is the vault, and chats live in it. */
export function isChatItem(n: Pick<NoteSummary, "folderId" | "diskFolderId">): boolean {
  return isChatsPath(noteDiskFolder(n));
}

/** A sidebar chat as a Library-shaped item, for the source preview (the
 * owner, 2026-09-17: "I am trying to see the source md"). `isChatItem` and
 * `chatSlugOf` read it exactly as they read a Library row. */
export function chatPreviewItem(c: {
  slug: string;
  title: string;
  modifiedMs: number;
  pinned: boolean;
}): NoteSummary {
  return {
    id: `chats/${c.slug}.md`,
    title: c.title || c.slug,
    snippet: "",
    aliases: [c.slug],
    folderId: "chats",
    createdAt: c.modifiedMs,
    updatedAt: c.modifiedMs,
    pinned: c.pinned,
    kind: "note",
  };
}

/** The chat's slug — its filename stem, which Rust lists first among aliases. */
export function chatSlugOf(n: Pick<NoteSummary, "id" | "aliases">): string {
  return n.aliases?.[0] ?? n.id;
}

/** Where a chat sits in the Library's namespace: a `Chats` folder at the root
 * (the disk folder `chats/` is a sibling of `wiki/`, not inside it). */
export function libraryPathOfChat(diskFolder: string, prefix: string): string {
  const i = diskFolder.indexOf(":");
  const rel = i >= 0 ? diskFolder.slice(i + 1) : diskFolder;
  return `${prefix}/${rel}`;
}

export function kindLabel(n: NoteSummary): string {
  if (isChatItem(n)) return "Chat";
  if (n.kind === "board") return "Board";
  if (n.kind === "file") {
    const ext = n.id.slice(n.id.lastIndexOf(".") + 1).toLowerCase();
    return FILE_KINDS[ext] ?? (ext && ext !== n.id ? `${ext.toUpperCase()} file` : "File");
  }
  return "Note";
}
