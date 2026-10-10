// The roadmap's "Recently shipped": the newest released versions in CHANGELOG.md, each with
// its date and a few of its headline items, read at build time so the page can never claim a
// release, a date, or an item that the changelog doesn't. Nothing is written here but the rule:
//
//   - a release is a `## [x.y.z] - YYYY-MM-DD` heading ([Unreleased] is not one);
//   - its headline items are the bold leads of its bullets (`- **Lead.** more…`), taken word
//     for word, Added first, then Changed, then Fixed; a bullet without a bold lead is skipped;
//   - each release links to its own heading on /changelog/, whose id Astro derives from the
//     heading text the same way `changelogAnchor` does (the site E2E proves every link lands).
//
// Pure text in, data out (no file system, no Astro), like src/roadmap.ts and src/milestones.ts.
import { dateLabel } from './milestones';

export interface ShippedRelease {
  version: string;
  /** "2026-09-30" */
  date: string;
  /** "September 30, 2026" */
  label: string;
  /** The release's heading id on /changelog/: "171---2026-09-30". */
  anchor: string;
  /** Bold leads, word for word, without the closing stop; backticks mark code. */
  items: string[];
}

const RELEASE = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/;
const KIND = /^### (Added|Changed|Fixed)\s*$/;
const LEAD = /^- \*\*(.+?)\*\*/;
const ORDER = ['Added', 'Changed', 'Fixed'] as const;

/** The id Astro gives a changelog heading (github-slugger): lowercased, punctuation dropped, spaces to hyphens. */
export function changelogAnchor(version: string, date: string): string {
  return `[${version}] - ${date}`
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
}

/** A bold lead as the page shows it: the closing stop dropped ("Charts in your notes"). */
function lead(text: string): string {
  return text.trim().replace(/[.:]$/, '');
}

/**
 * The newest `count` releases, newest first (the file's order), each with up to `perRelease`
 * headline items. Throws if the changelog has fewer releases than asked for, so a broken
 * heading fails the build instead of quietly shrinking the list.
 */
export function recentReleases(changelog: string, count = 4, perRelease = 3): ShippedRelease[] {
  const releases: { version: string; date: string; leads: Record<string, string[]> }[] = [];
  let current: (typeof releases)[number] | null = null;
  let kind: string | null = null;
  /** A bullet whose bold lead wraps onto the next lines, read until the lead closes. */
  let pending: string | null = null;
  for (const line of changelog.split(/\r?\n/)) {
    if (pending !== null) {
      if (/^\s+\S/.test(line)) {
        pending += ` ${line.trim()}`;
        if (!LEAD.test(pending)) continue;
        if (current && kind) (current.leads[kind] ??= []).push(lead(LEAD.exec(pending)![1]));
      }
      pending = null;
      if (/^\s/.test(line)) continue;
    }
    const release = RELEASE.exec(line);
    if (release) {
      if (releases.length === count) break;
      current = { version: release[1], date: release[2], leads: {} };
      releases.push(current);
      kind = null;
      continue;
    }
    if (line.startsWith('## ')) {
      // [Unreleased] or anything else that is not a release ends the one being read.
      current = null;
      continue;
    }
    if (!current) continue;
    const heading = KIND.exec(line);
    if (heading) {
      kind = heading[1];
      continue;
    }
    if (line.startsWith('### ')) {
      kind = null;
      continue;
    }
    if (!kind || !line.startsWith('- **')) continue;
    const bold = LEAD.exec(line);
    if (bold) (current.leads[kind] ??= []).push(lead(bold[1]));
    else pending = line;
  }
  if (releases.length < count) {
    throw new Error(`CHANGELOG.md: asked for ${count} releases, found ${releases.length} dated headings.`);
  }
  return releases.map(({ version, date, leads }) => ({
    version,
    date,
    label: dateLabel(date),
    anchor: changelogAnchor(version, date),
    items: ORDER.flatMap((name) => leads[name] ?? []).slice(0, perRelease),
  }));
}
