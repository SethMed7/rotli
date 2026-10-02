// The text-alignment grammar (SYNTAX.md): a centered or right-aligned
// paragraph is one line of HTML, `<p align="center">…</p>` or
// `<p align="right">…</p>`. Left is the default and is never written —
// choosing it removes the tags. Pure and import-free, so the clipboard and the
// plain-text readers share it with the editor.

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const ALIGN_CLOSE = "</p>";
export const alignOpenTag = (align: TextAlign): string => `<p align="${align}">`;

// exactly the form Rotli writes; a hand-written `align="left"` reads too, so
// it can be unwrapped rather than nested
const ALIGNED_LINE = /^<p align="(left|center|right)">(.*)<\/p>$/;

export interface AlignedLine {
  align: TextAlign;
  /** Length of the opening tag; the closing tag is always ALIGN_CLOSE. */
  open: number;
  /** The paragraph's own Markdown between the tags. */
  inner: string;
}

export function parseAlignedLine(text: string): AlignedLine | null {
  const m = ALIGNED_LINE.exec(text);
  if (!m) return null;
  const align = m[1] as TextAlign;
  return { align, open: alignOpenTag(align).length, inner: m[2] ?? "" };
}

/** A line's alignment: its tag's, or left when it has none. */
export function alignOf(text: string): TextAlign {
  return parseAlignedLine(text)?.align ?? "left";
}
