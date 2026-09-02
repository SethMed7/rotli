// Title/snippet derivation shared by both NotesService implementations.
// THE TITLE LAW: the title is DERIVED from the first H1, never stored. Legacy
// notes without an H1 retain the first-non-empty-line fallback until renamed.
// The Rust corpus derives its own for list rows (corpus.rs title_of /
// snippet_of), so THESE MUST MATCH IT exactly — otherwise the same note shows
// one title in a list row (Rust) and another in an opened tab / moved note
// (TS). This is a faithful port of corpus.rs strip_markdown / title_of /
// snippet_of (kept in lockstep; see src/services/derive.test.ts).

// Rust trims with char::is_whitespace() (the Unicode White_Space set). That set
// differs from JS String.prototype.trim() by exactly two code points: Rust
// trims U+0085 (NEL) but NOT U+FEFF (BOM/ZWNBSP); JS does the opposite. The
// difference is load-bearing: external editors emit a leading BOM, so trimming
// it here (JS default) while the Rust list row keeps it would split one note
// into two titles. This char class is Rust's exact set — it INCLUDES U+0085 and
// (deliberately) EXCLUDES U+FEFF — so titleOf/snippetOf match the corpus.
const RWS = "\\t\\n\\v\\f\\r\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_TRIM_LEAD = new RegExp(`^[${RWS}]+`);
const RE_TRIM_TRAIL = new RegExp(`[${RWS}]+$`);
const rustTrimStart = (s: string): string => s.replace(RE_TRIM_LEAD, "");
const rustTrim = (s: string): string => s.replace(RE_TRIM_LEAD, "").replace(RE_TRIM_TRAIL, "");

/** Split like Rust's str::lines(): on '\n', dropping a single trailing '\r'. */
function lines(body: string): string[] {
  return body.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

export const BLOCK_MARKERS = [
  "- ",
  "* ",
  "+ ",
  "( ) ",
  "(x) ",
  "(X) ",
  "[ ][ ] ",
  "[x][ ] ",
  "[X][ ] ",
  "[ ][x] ",
  "[ ][X] ",
  "[ ] ",
  "[/] ",
  "[x] ",
  "[X] ",
] as const;

/** Mirror of corpus.rs strip_markdown: trim, then iteratively peel a leading
 * run of '#', a leading '>', and one list/checkbox marker per pass until the
 * line stops changing, then drop every '*', '_' and '`' character and trim. */
function stripMarkdown(line: string): string {
  let s = rustTrim(line);
  for (;;) {
    const before = s;
    s = rustTrimStart(s.replace(/^#+/, ""));
    if (s.startsWith(">")) s = rustTrimStart(s.slice(1));
    for (const marker of BLOCK_MARKERS) {
      if (s.startsWith(marker)) s = s.slice(marker.length);
    }
    if (s === before) break;
  }
  // `![alt](url)` → alt (or "Image" when the alt is empty) and `[text](url)` →
  // text — a note that starts with an image reads as a human title, never raw
  // markdown. Images first, then links, in lockstep with corpus.rs
  // reduce_md_links (label runs to the FIRST ']', url to the FIRST ')').
  s = s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt: string) => alt || "Image");
  s = s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_m, text: string) => text);
  return rustTrim(s.replace(/[*_`]/g, ""));
}

function h1Title(line: string): string | null {
  const trimmed = rustTrimStart(line);
  if (!trimmed.startsWith("#") || trimmed.startsWith("##")) return null;
  const rest = trimmed.slice(1);
  if (!rest || !new RegExp(`^[${RWS}]`).test(rest)) return null;
  const title = stripMarkdown(rest);
  return title || null;
}

/** Title = first H1; pre-v3.8 H1-less notes keep the legacy fallback. */
export function titleOf(body: string): string {
  for (const line of lines(body)) {
    const title = h1Title(line);
    if (title) return title;
  }
  for (const line of lines(body)) {
    const stripped = stripMarkdown(line);
    if (stripped) return stripped;
  }
  return "Untitled";
}

/** Snippet = every line after the title line, stripped and joined by single
 * spaces, capped at 140 code points (Rust .chars().take(140)). The title line
 * is the first line that isn't blank; everything before it is skipped too. */
export function snippetOf(body: string): string {
  const parts: string[] = [];
  let pastTitle = false;
  for (const line of lines(body)) {
    if (!pastTitle) {
      if (rustTrim(line) !== "") pastTitle = true;
      continue;
    }
    const stripped = stripMarkdown(line);
    if (stripped) parts.push(stripped);
  }
  return [...parts.join(" ")].slice(0, 140).join("");
}

/** The one list order — a faithful port of corpus_list's sort (corpus.rs
 * `list()`: pinned first, then `updated_at` desc, then id asc), shared by the
 * in-memory service and the scoped cache patch (applyNoteWrite) so a patched
 * list can never disagree with the next full refetch. Kept in lockstep like
 * titleOf/snippetOf above; locked by derive.test.ts. */
export function summaryOrder(
  a: { pinned: boolean; updatedAt: number; id: string },
  b: { pinned: boolean; updatedAt: number; id: string },
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
