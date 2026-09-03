// The pure full-text ranking + snippet grammar — the browser twin of the Rust
// core (src-tauri/src/search_match.rs). InMemoryNotesService searches through
// THIS so the dev surface behaves like the shell; the vectors in
// search.test.ts mirror the Rust tests and MUST stay in lockstep.
//
// Rank (lower sorts first): 0 whole query in the TITLE · 1 every query word in
// the title (any order) · 2 whole query in the body · 3 every word in the body
// · 4 index-only. Spans are [start, len] CHAR counts (code points): into the
// title for 0–1, into the returned snippet for 2–3. matchStart/matchLen mirror
// the first span for callers that predate spans.

import type { SearchHit } from "../types";

/** Context chars on each side of a body match in the snippet window. */
const SNIPPET_CTX = 60;
const MAX_TOKENS = 16;

export const RANK_TITLE = 0;
export const RANK_TITLE_WORDS = 1;
export const RANK_BODY = 2;
export const RANK_BODY_WORDS = 3;

/** True for a hit whose spans index the TITLE (ranks 0–1). */
export const isTitleHit = (rank: number): boolean => rank <= RANK_TITLE_WORDS;
/** True for a hit whose spans index the SNIPPET (ranks 2–3). */
export const isBodyHit = (rank: number): boolean => rank === RANK_BODY || rank === RANK_BODY_WORDS;

/** Per-char case fold: the FIRST code point of each lowercase expansion —
 * strictly 1:1 (Rust `to_lowercase().next()`), so a char offset in the folded
 * text equals the offset in the original. */
function fold(s: string): string[] {
  return [...s].map((c) => [...c.toLowerCase()][0] ?? c);
}

function findCiFrom(hay: string[], needle: string[], from: number): number {
  if (needle.length === 0 || needle.length > hay.length || from > hay.length - needle.length) return -1;
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const findCi = (hay: string[], needle: string[]): number => findCiFrom(hay, needle, 0);

/** The query's words: split on anything non-alphanumeric, lowercased, deduped,
 * first 16 — the Rust `query_tokens` twin (the index builds its query from it). */
export function queryTokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const t = raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
    if (out.length === MAX_TOKENS) break;
  }
  return out;
}

/** `<!-- … -->` blocks removed (an unterminated one runs to the end). */
export function stripHtmlComments(s: string): string {
  let out = "";
  let rest = s;
  for (;;) {
    const i = rest.indexOf("<!--");
    if (i < 0) return out + rest;
    out += rest.slice(0, i);
    const j = rest.indexOf("-->", i + 4);
    if (j < 0) return out;
    rest = rest.slice(j + 3);
  }
}

function mergeSpans(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, l] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[0] + last[1]) {
      last[1] = Math.max(s + l, last[0] + last[1]) - last[0];
      continue;
    }
    out.push([s, l]);
  }
  return out;
}

function wordSpans(hay: string[], words: string[][]): [number, number][] | null {
  const spans: [number, number][] = [];
  for (const w of words) {
    const i = findCi(hay, w);
    if (i < 0) return null;
    spans.push([i, w.length]);
  }
  return mergeSpans(spans);
}

export interface SearchMatch {
  rank: number;
  snippet: string;
  matchStart: number;
  matchLen: number;
  spans: [number, number][];
}

/** A ±60-char window around `anchor`: newlines flatten, emphasis chars are
 * stripped OUTSIDE the spans (inside stays verbatim so a span always frames
 * exactly what matched), "…" marks a clipped edge. Returned spans index the
 * snippet. */
function window(
  chars: string[],
  anchor: number,
  anchorLen: number,
  spans: [number, number][],
): { snippet: string; spans: [number, number][] } {
  const start = Math.max(0, anchor - SNIPPET_CTX);
  const end = Math.min(chars.length, anchor + anchorLen + SNIPPET_CTX);
  let snippet = "";
  const out: [number, number][] = [];
  let written = 0;
  if (start > 0) {
    snippet += "…";
    written = 1;
  }
  let open = -1;
  for (let p = start; p < end; p++) {
    const c = chars[p] as string;
    const k = spans.findIndex(([s, l]) => p >= s && p < s + l);
    if (k < 0 && (c === "*" || c === "_" || c === "`")) continue;
    if (k >= 0) {
      if (open !== k) {
        open = k;
        out.push([written, 0]);
      }
      (out[out.length - 1] as [number, number])[1] += 1;
    } else open = -1;
    snippet += c === "\n" || c === "\r" || c === "\t" ? " " : c;
    written += 1;
  }
  if (end < chars.length) snippet += "…";
  return { snippet, spans: out };
}

const firstOf = (spans: [number, number][]): [number, number] => spans[0] ?? [0, 0];

/** The ranking + snippet grammar. Lockstep twin of Rust `search_match`. */
export function searchMatch(
  query: string,
  title: string,
  body: string,
  storedSnippet: string,
): SearchMatch | null {
  const q = fold(query.trim());
  if (q.length === 0) return null;
  const words = queryTokens(query).map(fold);
  const titleF = fold(title);
  const ti = findCi(titleF, q);
  const titleSpans =
    ti >= 0 ? [[ti, q.length] as [number, number]] : words.length > 0 ? wordSpans(titleF, words) : null;
  if (titleSpans) {
    const [matchStart, matchLen] = firstOf(titleSpans);
    return {
      rank: ti >= 0 ? RANK_TITLE : RANK_TITLE_WORDS,
      snippet: storedSnippet,
      matchStart,
      matchLen,
      spans: titleSpans,
    };
  }
  const chars = [...body];
  const bodyF = fold(body);
  const bi = findCi(bodyF, q);
  if (bi >= 0) {
    const w = window(chars, bi, q.length, [[bi, q.length]]);
    const [matchStart, matchLen] = firstOf(w.spans);
    return { rank: RANK_BODY, snippet: w.snippet, matchStart, matchLen, spans: w.spans };
  }
  if (words.length === 0) return null;
  const all = wordSpans(bodyF, words);
  if (!all) return null;
  const anchor = all[0] as [number, number];
  const start = Math.max(0, anchor[0] - SNIPPET_CTX);
  const end = Math.min(chars.length, anchor[0] + anchor[1] + SNIPPET_CTX);
  const inWindow: [number, number][] = [];
  for (const w of words) {
    const i = findCiFrom(bodyF, w, start);
    if (i >= 0 && i + w.length <= end) inWindow.push([i, w.length]);
  }
  const w = window(chars, anchor[0], anchor[1], mergeSpans(inWindow));
  const [matchStart, matchLen] = firstOf(w.spans);
  return { rank: RANK_BODY_WORDS, snippet: w.snippet, matchStart, matchLen, spans: w.spans };
}

/** rank asc → recency desc → id asc (deterministic), the exact Rust
 * `sort_hits` order. Returns a new array. */
export function sortHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort(
    (a, b) => a.rank - b.rank || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
