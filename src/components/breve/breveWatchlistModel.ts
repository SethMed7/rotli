// Pure draft model for the Watchlist editor: editable ids, markdown round-trip,
// website normalization, and per-row validation. No React, no effects — the
// view (breveWatchlist.tsx) renders this; the markdown contract stays owned by
// src/routines/watchlist.ts.

import { normalizedWebsite } from "../../lib/webUrl";
import {
  legacyWatchUrl,
  parseWatchlist,
  serializeWatchlist,
  type WatchItem,
  type WatchSection,
} from "../../routines/watchlist";

export type EditableWatchItem = WatchItem & { id: string };
export type EditableWatchSection = Omit<WatchSection, "items"> & {
  id: string;
  items: EditableWatchItem[];
};

export function editId(): string {
  return crypto.randomUUID();
}

/** Compact display form of a topic's website: the bare hostname. */
export function websiteDomain(value: string | undefined): string {
  const normalized = normalizedWebsite(value ?? "");
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function editableWatchlist(markdown: string): {
  sections: EditableWatchSection[];
  preferences: string;
} {
  const parsed = parseWatchlist(markdown);
  return {
    preferences: parsed.preferences,
    sections: parsed.sections.map((section) => ({
      ...section,
      note: section.note ?? "",
      id: editId(),
      items: section.items.map((item) => ({
        ...item,
        url: item.url ?? legacyWatchUrl(item.watch),
        id: editId(),
      })),
    })),
  };
}

export function watchlistDocument(sections: EditableWatchSection[], preferences: string): string {
  return serializeWatchlist({
    preferences,
    sections: sections.map(({ title, note, items }) => ({
      title,
      ...(note ? { note } : {}),
      items: items.map(({ watch, lens, url }) => ({
        watch,
        lens,
        ...(url?.trim() ? { url: url.trim() } : {}),
      })),
    })),
  });
}

/** What is wrong with this topic, or null. Shown on the row it belongs to. */
export function itemIssue(item: EditableWatchItem): string | null {
  if (!item.watch.trim()) return "Name this topic, or remove it.";
  if (item.url?.trim() && !normalizedWebsite(item.url))
    return `“${item.url}” is not a valid website. Use a domain or an http/https URL.`;
  return null;
}

/** What is wrong with this group's name, or null. Shown under its header. */
export function sectionIssue(
  sections: readonly EditableWatchSection[],
  section: EditableWatchSection,
): string | null {
  const title = section.title.trim();
  if (!title) return "Name this group, or remove it.";
  const duplicates = sections.filter(
    (candidate) => candidate.title.trim().toLowerCase() === title.toLowerCase(),
  );
  if (duplicates.length > 1) return `“${title}” is used more than once. Give each group a unique name.`;
  return null;
}

/** True when any group or topic blocks saving. */
export function watchlistHasIssues(sections: readonly EditableWatchSection[]): boolean {
  return sections.some(
    (section) => sectionIssue(sections, section) !== null || section.items.some((item) => itemIssue(item)),
  );
}
