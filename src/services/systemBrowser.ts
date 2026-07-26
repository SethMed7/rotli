// The System browser fold (Seth, 2026-07-26): System rows (Library · Assets ·
// Archive · Trash) open a Finder-style surface on the right instead of inline
// sidebar dropdowns. This module is the pure part — scope items, filter them,
// and group them by their REAL folder paths (Finder truth: physical structure,
// never the sidebar's synthetic type grouping). The surface renders.

import { noteDiskFolder } from "../lib/noteLocation";
import type { NoteSummary } from "../types";

export type SystemViewMode = "folders" | "list";

export interface SystemGroup {
  /** The full folder path key ("" = items sitting at the root). */
  path: string;
  /** Humanized display ("Projects › rotli", "Secure notes"). */
  label: string;
  items: NoteSummary[];
}

/** Humanize one folder segment — internal names get their display names. */
export function folderSegmentLabel(seg: string): string {
  if (seg === "_secure") return "Secure notes";
  if (seg === "_inbox") return "Captures";
  if (seg === "Storage") return "Assets";
  return seg;
}

/** pinned float first, then most-recently touched — every listing's order. */
function sortItems(items: NoteSummary[]): NoteSummary[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** The instant search filter (title + snippet, case-insensitive). */
export function filterSystemItems(items: NoteSummary[], query: string): NoteSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sortItems(items);
  return sortItems(
    items.filter((n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q)),
  );
}

/** A folder path relative to the root, humanized ("wiki/Projects/rotli" with
 * rootPrefix "wiki" → "Projects › rotli"). "" for items at the root itself. */
function relLabel(path: string, rootPrefix: string): string {
  const rel = path === rootPrefix ? "" : path.replace(new RegExp(`^${rootPrefix}/`), "");
  if (!rel) return "";
  return rel.split("/").map(folderSegmentLabel).join(" › ");
}

/** Group scoped items by their real folder (Folders mode): root items first,
 * then folders in path order, each folder's items pinned→recency. The search
 * query filters ITEMS — a folder with no matches disappears entirely. */
export function groupSystemItems(items: NoteSummary[], rootPrefix: string, query: string): SystemGroup[] {
  const filtered = filterSystemItems(items, query);
  const byPath = new Map<string, NoteSummary[]>();
  for (const n of filtered) {
    const path = noteDiskFolder(n);
    const list = byPath.get(path) ?? [];
    list.push(n);
    byPath.set(path, list);
  }
  const paths = [...byPath.keys()].sort((a, b) => a.localeCompare(b));
  const groups: SystemGroup[] = [];
  for (const path of paths) {
    const label = relLabel(path, rootPrefix);
    groups.push({ path, label, items: byPath.get(path) ?? [] });
  }
  // root items ("" label) lead — the Finder rule: loose files above folders
  groups.sort((a, b) => Number(a.label !== "") - Number(b.label !== "") || a.label.localeCompare(b.label));
  return groups;
}
