// The System browser (Finder rework 2026-07-27, from Seth's screenshots): the
// browser is SPATIAL, exactly like a traditional Finder — you are IN one
// folder and see only its direct contents: subfolders rendered as folders,
// notes as items. You enter a folder to descend, climb back by breadcrumb.
// "Folders" is the icon-grid view; "List" is the columned list (Name · Date
// Modified · Kind). This module is the pure part; the surface renders.

import { noteDiskFolder } from "../lib/noteLocation";
import type { NoteSummary } from "../types";

export type SystemViewMode = "folders" | "list" | "columns";
export type SystemSortKey = "name" | "date";

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
  return seg;
}

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
 * order: folders and items each name-ascending. */
export function listFolderContents(
  items: NoteSummary[],
  cwd: string,
  seedFolders: readonly string[] = [],
): FolderListing {
  const children = new Set<string>();
  const direct: NoteSummary[] = [];
  for (const n of items) {
    const path = noteDiskFolder(n);
    if (path === cwd) {
      direct.push(n);
      continue;
    }
    const child = childOf(cwd, path);
    if (child) children.add(child);
  }
  for (const seed of seedFolders) {
    if (seed === cwd) continue;
    const child = childOf(cwd, seed);
    if (child) children.add(child);
  }
  const folders = [...children].sort(byName).map((path) => {
    const inside = items.filter((n) => {
      const p = noteDiskFolder(n);
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
 * own bands (folders never interleave with items — the list view's grammar). */
export function sortFolderListing(l: FolderListing, key: SystemSortKey, dir: 1 | -1): FolderListing {
  const folders = [...l.folders].sort((a, b) =>
    key === "name" ? dir * byName(a.name, b.name) : dir * ((a.updatedAt ?? 0) - (b.updatedAt ?? 0)),
  );
  const items = [...l.items].sort((a, b) =>
    key === "name" ? dir * byName(a.title, b.title) : dir * (a.updatedAt - b.updatedAt),
  );
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

/** Finder's Kind column — extension-aware for files (Seth, 2026-07-28:
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

export function kindLabel(n: NoteSummary): string {
  if (n.kind === "board") return "Board";
  if (n.kind === "file") {
    const ext = n.id.slice(n.id.lastIndexOf(".") + 1).toLowerCase();
    return FILE_KINDS[ext] ?? (ext && ext !== n.id ? `${ext.toUpperCase()} file` : "File");
  }
  return "Note";
}
