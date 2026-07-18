// The pure full-text ranking + snippet grammar — the browser twin of the Rust
// corpus_search core (corpus.rs search_match / sort_hits). InMemoryNotesService
// searches through THIS so the dev surface behaves like the shell; the vectors
// in search.test.ts mirror the Rust tests and MUST stay in lockstep. Rank 0 =
// title hit (offsets index the TITLE, snippet is the stored list snippet),
// rank 1 = body hit (offsets index the returned snippet window). All offsets
// are CHAR counts (code points) — the Rust side counts chars, never bytes.

import type { SearchHit } from "../types";

/** Context chars on each side of a body match in the snippet window. */
const SNIPPET_CTX = 60;

/** Per-char case fold: the FIRST code point of each lowercase expansion —
 * strictly 1:1 (Rust `to_lowercase().next()`), so a char offset in the folded
 * text equals the offset in the original. 'İ' folds to 'i' on both sides. */
function fold(s: string): string[] {
  return [...s].map((c) => [...c.toLowerCase()][0] ?? c);
}

/** Char offset of the first occurrence of `needle` in `hay` (both folded). */
function findCi(hay: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export interface SearchMatch {
  rank: 0 | 1;
  snippet: string;
  matchStart: number;
  matchLen: number;
}

/** Title match beats body match. A body hit gets a ±60-char window around the
 * FIRST match: newlines flatten to spaces, emphasis chars (* _ `) are stripped
 * OUTSIDE the matched span (inside stays verbatim so the offsets always frame
 * exactly what matched), "…" marks a clipped edge. Lockstep twin of Rust
 * `search_match` (corpus.rs). */
export function searchMatch(
  query: string,
  title: string,
  body: string,
  storedSnippet: string,
): SearchMatch | null {
  const q = fold(query.trim());
  if (q.length === 0) return null;
  const ti = findCi(fold(title), q);
  if (ti >= 0) return { rank: 0, snippet: storedSnippet, matchStart: ti, matchLen: q.length };
  const chars = [...body];
  const bi = findCi(fold(body), q);
  if (bi < 0) return null;
  const start = Math.max(0, bi - SNIPPET_CTX);
  const end = Math.min(chars.length, bi + q.length + SNIPPET_CTX);
  let snippet = "";
  let matchStart = bi - start;
  if (start > 0) {
    snippet += "…";
    matchStart += 1;
  }
  for (let w = 0; w < end - start; w++) {
    const c = chars[start + w] as string;
    const inMatch = w >= bi - start && w < bi - start + q.length;
    if (!inMatch && (c === "*" || c === "_" || c === "`")) {
      if (w < bi - start) matchStart -= 1;
      continue;
    }
    snippet += c === "\n" || c === "\r" || c === "\t" ? " " : c;
  }
  if (end < chars.length) snippet += "…";
  return { rank: 1, snippet, matchStart, matchLen: q.length };
}

/** rank asc (title hits first) → recency desc → id asc (deterministic), the
 * exact Rust `sort_hits` order. Returns a new array. */
export function sortHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort(
    (a, b) => a.rank - b.rank || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
