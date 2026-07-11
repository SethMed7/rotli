// Pure parser for the Rotli-managed Breve watchlist markdown (see breve-merge.md
// §2.3). The watchlist migrates VERBATIM into the merged app as a
// real memex note; this turns its `## Section` + `| Watch | Lens |` tables into
// structured data the routines engine can iterate, and lifts the free-text
// "Brief preferences" block out separately (it's guidance, not a watch/lens row).

export interface WatchItem {
  watch: string;
  lens: string;
  /** Optional canonical website or source used when researching this topic. */
  url?: string;
}

export interface WatchSection {
  title: string;
  items: WatchItem[];
  /** Optional prose guidance that applies only to this group. */
  note?: string;
}

export interface Watchlist {
  sections: WatchSection[];
  /** The "Brief preferences" block, verbatim (trimmed). Empty if absent. */
  preferences: string;
}

/** Canonical sources for the original Breve watchlist. This is a compatibility
 * bridge for the legacy two-column document; once saved, URLs live in the
 * Markdown itself and this lookup is no longer involved. */
const LEGACY_WATCH_URLS = new Map<string, string>([
  ["bun", "https://bun.sh/"],
  ["node.js", "https://nodejs.org/"],
  ["voidzero / vite / vitest", "https://voidzero.dev/"],
  ["astro", "https://astro.build/"],
  ["next.js / vercel", "https://vercel.com/"],
  ["typescript", "https://www.typescriptlang.org/"],
  ["docker", "https://www.docker.com/"],
  ["anthropic / claude code", "https://www.anthropic.com/claude-code"],
  ["openai / codex", "https://openai.com/codex/"],
  ["xai / grok", "https://x.ai/"],
  ["google / gemini", "https://gemini.google.com/"],
  ["openclaw", "https://openclaw.ai/"],
  ["nous hermes agent", "https://hermes-agent.nousresearch.com/"],
  ["opencode", "https://opencode.ai/"],
  ["superintelligence", "https://getsuperintel.com/"],
  ["coderabbit", "https://www.coderabbit.ai/"],
  ["codeant", "https://www.codeant.ai/"],
  ["greptile", "https://www.greptile.com/"],
  ["category broadly", "https://github.com/marketplace?category=code-review"],
  ["qwen, gemma, deepseek + the open-weight world generally", "https://huggingface.co/models"],
  ["minimax", "https://www.minimax.io/"],
  ["cloudflare", "https://www.cloudflare.com/"],
  ["nvidia", "https://www.nvidia.com/"],
  ["apple", "https://www.apple.com/"],
  ["spacex", "https://www.spacex.com/"],
  ["privacy-policy changes at major companies", "https://tosdr.org/"],
  ["cybersecurity risk", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"],
  ["socket (socket.dev)", "https://socket.dev/"],
  ["theo (t3.gg — t3 stack, t3 chat)", "https://t3.gg/"],
  ["tournaments", "https://www.fide.com/"],
  ["magnus carlsen, hikaru nakamura", "https://ratings.fide.com/top_lists.phtml"],
  ["praggnanandhaa (pragg)", "https://ratings.fide.com/profile/25059530"],
  ["gothamchess (levy rozman)", "https://www.youtube.com/@GothamChess"],
  ["call of duty", "https://www.callofduty.com/"],
]);

export function legacyWatchUrl(watch: string): string {
  return LEGACY_WATCH_URLS.get(watch.trim().toLowerCase()) ?? "";
}

/** Split a markdown table row into trimmed cell strings. */
function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      cell += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  if (escaped) cell += "\\";
  out.push(cell.trim());
  return out;
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

function markdownLink(value: string): { label: string; url: string } | null {
  const match = /^\[([\s\S]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(value.trim());
  return match ? { label: match[1] ?? "", url: match[2] ?? "" } : null;
}

function sourceUrl(value: string): string {
  const trimmed = value.trim();
  const linked = markdownLink(trimmed);
  if (linked) return linked.url;
  const autolink = /^<(https?:\/\/[^>]+)>$/.exec(trimmed);
  return (autolink?.[1] ?? trimmed).trim();
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
        const linkedWatch = markdownLink(cs[0] ?? "");
        const watch = cleanWatch(linkedWatch?.label ?? cs[0] ?? "");
        const lens = (cs[1] ?? "").trim();
        const url = sourceUrl(cs[2] ?? linkedWatch?.url ?? "");
        if (watch.length > 0) current.items.push({ watch, lens, ...(url ? { url } : {}) });
      }
      continue;
    }

    if (line.trim()) current.note = [current.note, line.trim()].filter(Boolean).join("\n");
  }

  return { sections, preferences: prefLines.join("\n").trim() };
}

function tableCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

/** Serialize the native collection editor back to the scheduler's Markdown
 * contract. The UI owns structure; Markdown stays a durable interchange file. */
export function serializeWatchlist(watchlist: Watchlist): string {
  const blocks = ["# Breve Watchlist"];
  for (const section of watchlist.sections) {
    const note = section.note?.trim();
    blocks.push(
      [
        `## ${section.title.trim()}`,
        "",
        ...(note ? [note, ""] : []),
        "| Watch | Lens | Website |",
        "|---|---|---|",
        ...section.items.map((item) =>
          `| ${tableCell(item.watch)} | ${tableCell(item.lens)} | ${item.url?.trim() ? `<${tableCell(item.url)}>` : ""} |`,
        ),
      ].join("\n"),
    );
  }
  if (watchlist.preferences.trim()) {
    blocks.push(`## Brief preferences\n\n${watchlist.preferences.trim()}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
