// Pure parser for Breve's watchlist markdown (see ~/breve/watchlist.md and
// breve-merge.md §2.3). The watchlist migrates VERBATIM into the merged app as a
// real memex note; this turns its `## Section` + `| Watch | Lens |` tables into
// structured data the routines engine can iterate, and lifts the free-text
// "Brief preferences" block out separately (it's guidance, not a watch/lens row).

export interface WatchItem {
  watch: string;
  lens: string;
}

export interface WatchSection {
  title: string;
  items: WatchItem[];
}

export interface Watchlist {
  sections: WatchSection[];
  /** The "Brief preferences" block, verbatim (trimmed). Empty if absent. */
  preferences: string;
}

/** Split a markdown table row into trimmed cell strings. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** A `|---|:--:|` style separator row. */
function isSeparator(line: string): boolean {
  const cs = cells(line);
  return cs.length > 0 && cs.every((c) => /^:?-+:?$/.test(c));
}

/** Strip surrounding markdown emphasis from a watch name → a clean label. */
function cleanWatch(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

const PREFERENCES_TITLE = "brief preferences";

/**
 * Parse watchlist markdown into `{ sections, preferences }`.
 *
 * - `## Heading` starts a section; its two-column `| Watch | Lens |` table
 *   (header + `---` separator, then rows) becomes `items`. Prose-only sections
 *   (e.g. "Markets") yield an empty `items` array.
 * - The `## Brief preferences` section is captured into `preferences` and is NOT
 *   returned as a section.
 * - Empty tables and blank input are handled (no items, no throw).
 */
export function parseWatchlist(md: string): Watchlist {
  const lines = md.split(/\r?\n/);
  const sections: WatchSection[] = [];
  const prefLines: string[] = [];

  let current: WatchSection | null = null;
  let inPreferences = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = /^##\s+(.*\S)\s*$/.exec(line);

    if (heading) {
      const title = (heading[1] ?? "").trim();
      if (title.toLowerCase() === PREFERENCES_TITLE) {
        inPreferences = true;
        current = null;
      } else {
        inPreferences = false;
        current = { title, items: [] };
        sections.push(current);
      }
      continue;
    }

    if (inPreferences) {
      prefLines.push(line);
      continue;
    }

    if (!current) continue;

    // A table header row (Watch/Lens) followed by a separator: consume both,
    // then read data rows until the table ends.
    const isRow = line.trim().startsWith("|");
    const next = lines[i + 1] ?? "";
    if (isRow && isSeparator(next)) {
      i++; // skip the separator
      while (i + 1 < lines.length && (lines[i + 1] ?? "").trim().startsWith("|")) {
        i++;
        const rowLine = lines[i] ?? "";
        if (isSeparator(rowLine)) continue;
        const cs = cells(rowLine);
        const watch = cleanWatch(cs[0] ?? "");
        const lens = (cs[1] ?? "").trim();
        if (watch.length > 0) current.items.push({ watch, lens });
      }
    }
  }

  return { sections, preferences: prefLines.join("\n").trim() };
}
