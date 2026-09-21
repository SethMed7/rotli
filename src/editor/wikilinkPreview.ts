// The pure half of the wikilink hover card: which link sits under a column,
// and what the top of a note reads like. No CodeMirror or React imports, so it
// unit-tests headless; wikilinkHover.ts owns the tooltip.

import { stripMarkdown } from "./stripMarkdown";
import { WIKILINK_RE } from "./wikilink";

export const PREVIEW_MAX_LINES = 8;
const PREVIEW_MAX_CHARS = 140;

export interface WikilinkSpan {
  from: number;
  to: number;
  /** The text between the brackets — `target`, `target|display`, `target#heading`. */
  target: string;
}

/** The `[[link]]` under `col` on one line of Markdown source (both edges
 * count). Runs on the underlying text, so it holds in beautified and raw mode. */
export function wikilinkAt(lineText: string, col: number): WikilinkSpan | null {
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(lineText)) !== null) {
    if (m.index > col) break;
    const to = m.index + m[0].length;
    if (col <= to) return { from: m.index, to, target: m[1] ?? "" };
  }
  return null;
}

/** The first few lines of a note as they READ: markers dropped, the title the
 * card already shows left out, fences and image embeds skipped whole (their
 * source is not prose). Empty when the note has nothing under its title. */
export function previewText(body: string, title: string): string {
  const out: string[] = [];
  let fenced = false;
  let more = false;
  let first = true;
  for (const raw of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(raw)) continue;
    const line = stripMarkdown(raw).trim();
    if (!line) continue;
    const wasFirst = first;
    first = false;
    if (wasFirst && /^#\s/.test(raw.trim()) && line === title.trim()) continue;
    if (out.length === PREVIEW_MAX_LINES) {
      more = true;
      break;
    }
    out.push(line.length > PREVIEW_MAX_CHARS ? `${line.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : line);
  }
  return more ? [...out, "…"].join("\n") : out.join("\n");
}
