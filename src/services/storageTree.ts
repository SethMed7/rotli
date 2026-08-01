// Storage organization (Seth, 2026-06-30). Storage is a flat list of binaries on
// disk; this regroups them into a clean tree IN THE FRONTEND — no backend change,
// instant toggle. Three modes (a Settings knob): by Type (the default — Audio /
// Images / PDFs / Documents / Other), by Date (Year / Month, filename-date first so
// a clone's reset mtime can't reshuffle), or by Folder (the raw on-disk subdirs;
// loose files sit at the Storage top, i.e. "flat"). Pure functions of the fields the
// sidebar already has per file (id relpath, title, updatedAt), so it's deterministic.

import { DOCUMENT_EXTS } from "../documents/kinds";
import type { Folder, NoteSummary } from "../types";

export type StorageGrouping = "type" | "date" | "folder";

const TYPE_BUCKETS: [string, Set<string>][] = [
  ["Audio", new Set("mp3 m4a wav aac flac ogg oga opus aiff wma".split(" "))],
  ["Images", new Set("png jpg jpeg gif webp heic heif svg bmp tiff tif avif ico".split(" "))],
  ["PDFs", new Set(["pdf"])],
  ["Documents", new Set([...DOCUMENT_EXTS, ..."txt html htm csv tsv json xml yaml yml md".split(" ")])],
];
const TYPE_ORDER = ["Audio", "Images", "PDFs", "Documents", "Other"];

// NOT lib/fileKind's extOf: an extensionless name must yield "" (→ the Other
// bucket), while the shared helper returns the whole name — a file literally
// named "png" must not land in Images.
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}
function typeCat(name: string): string {
  const ext = extOf(name);
  return TYPE_BUCKETS.find(([, set]) => set.has(ext))?.[0] ?? "Other";
}
function dateSegs(name: string, mtimeMs: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (m && m[1] && m[2] && +m[2] >= 1 && +m[2] <= 12) return [m[1], m[2]];
  const d = new Date(mtimeMs);
  return [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0")];
}
function folderSegs(id: string): string[] {
  // id is "storage/<sub>/…/file.ext" (or "vault:storage/…"); drop the storage root + filename
  const rel = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return rel.split("/").slice(1, -1);
}

/** Regroup flat Storage notes into a synthetic { folders, re-homed notes } tree for
 * the requested mode. The synthetic folder ids are "Storage/<seg>/…" so they nest
 * under the existing "Storage" destination; each note's `folderId` is re-homed to its
 * deepest synthetic folder (or "Storage" itself when it has no segments). */
export function buildStorageTree(
  notes: NoteSummary[],
  mode: StorageGrouping,
): { folders: Folder[]; notes: NoteSummary[] } {
  const folders: Folder[] = [];
  const seen = new Set<string>();
  const homed = notes.map((n) => {
    const segs =
      mode === "type"
        ? [typeCat(n.title)]
        : mode === "date"
          ? dateSegs(n.title, n.updatedAt)
          : folderSegs(n.id);
    let parent = "Storage";
    let path = "Storage";
    for (const seg of segs) {
      path = `${path}/${seg}`;
      if (!seen.has(path)) {
        seen.add(path);
        folders.push({ id: path, name: seg, parentId: parent });
      }
      parent = path;
    }
    return { ...n, folderId: path };
  });
  return { folders: orderStorage(folders, mode), notes: homed };
}

function orderStorage(folders: Folder[], mode: StorageGrouping): Folder[] {
  if (mode === "type") {
    return [...folders].sort((a, b) => {
      if (a.parentId === "Storage" && b.parentId === "Storage") {
        return TYPE_ORDER.indexOf(a.name) - TYPE_ORDER.indexOf(b.name);
      }
      return a.id.localeCompare(b.id);
    });
  }
  if (mode === "date") {
    return [...folders].sort((a, b) => b.id.localeCompare(a.id)); // newest first
  }
  return [...folders].sort((a, b) => a.id.localeCompare(b.id));
}
