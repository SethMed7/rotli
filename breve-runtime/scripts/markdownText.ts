// Breve's one home for markdown-text handling (remediation Batch 3, F20d):
// render-brief (md → readable HTML) and audio-brief (md → spoken text) each
// carried their own copy and the italic rules had drifted — render-brief
// italicized "2 * 3 * 4". The inline behavior is pinned by
// scripts/fixtures/markdown-strip.json, which the app-side mirror
// (src/editor/stripMarkdown.ts, MIRROR-NOT-IMPORT across that boundary) asserts
// against too — behavior parity, not shared source.

/** Emphasis opens/closes only against non-space, non-`*` content (the editor's
 * rule, CommonMark-flavored) — a spaced `*` is arithmetic, not italics. */
const MD_ITALIC = /\*([^*\s](?:[^*]*[^*\s])?)\*/g;

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline markdown → HTML for the brief renderers (bold/link/code/italic). */
export function inlineHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(MD_ITALIC, "<em>$1</em>");
}

/** Markdown → plain SPOKEN text: links become their text, URLs vanish, and any
 * leftover formatting symbol is scrubbed (the small local model occasionally
 * leaks one into a script). Deterministic, and preserves the
 * [[anchor]]/[[security]]/[[personal]] voice markers — they contain no (…) and
 * none of the scrubbed chars. */
export function stripMarkdown(src: string): string {
  return src
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>#|]/g, "")
    .replace(/^\s*-\s*/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
