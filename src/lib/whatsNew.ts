// What's new (2026-09-28): after an update, a short list of the release's top
// changes (src/assets/whats-new.json, bundled so Rotli Web needs no fetch),
// shown once. Pure: the dialog asks `whatsNewDecision` and records the version.

import bundled from "../assets/whats-new.json";

export type Platform = "mac" | "web";

export interface Highlight {
  title: string;
  body: string;
  /** Only when the change lives on one platform; absent means both. */
  platform?: Platform;
}

export type WhatsNew = Record<string, readonly Highlight[]>;

/** Only well-formed highlights survive: a title and a body, and a platform
 * that is "mac" or "web" when present. */
export function parseWhatsNew(raw: unknown): WhatsNew {
  const out: Record<string, Highlight[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [version, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    out[version] = list.flatMap((item: unknown): Highlight[] => {
      if (!item || typeof item !== "object") return [];
      const { title, body, platform } = item as Record<string, unknown>;
      if (typeof title !== "string" || typeof body !== "string") return [];
      if (platform === "mac" || platform === "web") return [{ title, body, platform }];
      return platform === undefined ? [{ title, body }] : [];
    });
  }
  return out;
}

/** The highlights that ship with this build. */
export const WHATS_NEW: WhatsNew = parseWhatsNew(bundled);

/** Where "See everything new" goes: the full changelog on the site. */
export const CHANGELOG_URL = "https://rotli.co/changelog/";

export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function highlightsFor(notes: WhatsNew, version: string): readonly Highlight[] | null {
  const items = notes[version];
  return items && items.length > 0 ? items : null;
}

/** The newest release that has highlights (the palette command reopens it). */
export function latestHighlights(notes: WhatsNew): { version: string; items: readonly Highlight[] } | null {
  const version = Object.keys(notes)
    .filter((key) => (notes[key]?.length ?? 0) > 0)
    .sort(compareVersions)
    .at(-1);
  return version ? { version, items: notes[version]! } : null;
}

export function platformNote(platform: Platform | undefined): string | null {
  if (platform === "mac") return "Mac app only";
  if (platform === "web") return "Rotli Web only";
  return null;
}

/** Show once after an update; never on a fresh install's first run. `record`
 * means "remember this version as seen" (on close when it shows). */
export function whatsNewDecision(input: {
  current: string;
  lastSeen: string;
  onboarded: boolean;
  onboardingVersion: string;
  notes: WhatsNew;
}): { show: boolean; record: boolean } {
  const has = highlightsFor(input.notes, input.current) !== null;
  if (input.lastSeen) {
    const newer = compareVersions(input.lastSeen, input.current) < 0;
    return { show: has && newer, record: input.lastSeen !== input.current };
  }
  // never recorded: an update only for someone set up on an older build; a
  // first run, or settings that never kept a version, record it quietly
  const upgraded =
    input.onboarded &&
    !!input.onboardingVersion &&
    compareVersions(input.onboardingVersion, input.current) < 0;
  return { show: has && upgraded, record: true };
}
