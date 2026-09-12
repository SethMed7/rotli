// Cell text, both ways. GFM has no multi-line cell, so a line break inside a
// cell is the conventional `<br>`: the editor shows real lines, the source
// keeps one row per line, and every plain-text reader flattens it to a space.
// Pure (no DOM), so the renderer's ratchet stays put and the rules unit-test.

const BR = /<br\s*\/?>/gi;

/** Escape HTML, then apply a minimal inline render (bold · italic · code ·
 * `<br>` line breaks) so cell text reads beautified without opening an
 * HTML-injection hole. */
export function inlineCell(raw: string): string {
  let s = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // [text](url) → just the text, styled (a notes app, not a browser)
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="md-link">$1</span>');
  return s;
}

/** The accessible name of a column: its header without markup, or its number. */
export function plainCellLabel(raw: string, col: number): string {
  const label = raw
    .replace(BR, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~=]/g, "")
    .trim();
  return label || `column ${col + 1}`;
}

/** Source → what the cell editor shows: every `<br>` becomes a real line. */
export function cellEditValue(raw: string): string {
  return raw.replace(BR, "\n");
}

/** Editor → source: real lines become `<br>`; a row stays one line. */
export function cellSourceValue(text: string): string {
  return text.replace(/\r?\n/g, "<br>");
}

/** Source → plain text for clipboards and print: a break reads as a space. */
export function flattenCellBreaks(raw: string): string {
  return raw.replace(BR, " ");
}
