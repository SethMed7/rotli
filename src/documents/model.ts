/** Framework-free document concepts shared by every editor and file adapter. */

export interface DocumentBlock {
  kind: "paragraph" | "heading";
  text: string;
  level?: 1 | 2 | 3;
}

export interface DocumentImage {
  /** Stable inside one document package; not a filesystem identity. */
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/bmp";
  /** Raw base64 bytes without a data-URL prefix. */
  base64: string;
  widthPx: number;
  heightPx: number;
  alt?: string;
}

export interface DocumentDraft {
  title: string;
  subtitle?: string;
  blocks?: DocumentBlock[];
  table?: string[][];
  /** Ordered native content for structured generated documents. Legacy block
   * and table inputs remain supported for ordinary blank/template creation. */
  content?: DocumentContent[];
  /** Generated visuals are conventional embedded DOCX media. */
  images?: DocumentImage[];
}

export type DocumentAlignment = "left" | "center" | "right" | "justify";
export type DocumentNamedStyle = "normal" | "title" | "subtitle" | "heading1" | "heading2" | "heading3";

/** The common, portable Word subset Rotli edits locally. Keeping this model
 * framework-free lets Univer (or a future editor) remain a replaceable adapter. */
export interface DocumentTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  /** Run shading behind the text as `#RRGGBB` (DOCX `w:shd w:fill`). */
  background?: string;
  verticalAlign?: "subscript" | "superscript";
}

export interface DocumentRun {
  text: string;
  style?: DocumentTextStyle;
  /** A web or mail link (`safeLinkUrl`); Word's external hyperlink. */
  link?: string;
}

/** Text whose `[label](url)` links become linked runs (a link Rotli can't
 * open keeps its label); always at least one run. */
export function runsWithLinks(text: string): DocumentRun[] {
  const runs: DocumentRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index) });
    const link = safeLinkUrl(match[2]);
    runs.push(link ? { text: match[1] ?? "", link } : { text: match[1] ?? "" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || !runs.length) runs.push({ text: text.slice(cursor) });
  return runs;
}

/** The link a document may carry and open: http(s) with a host, or mailto.
 * Anything else (javascript:, file:, an in-document anchor) is no link. */
export function safeLinkUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (/^mailto:[^\s]+$/i.test(text)) return text;
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text).hostname ? text : undefined;
  } catch {
    return undefined;
  }
}

export interface DocumentParagraph {
  runs: DocumentRun[];
  namedStyle?: DocumentNamedStyle;
  alignment?: DocumentAlignment;
  list?: "bullet" | "number";
}

export interface DocumentTableCell {
  paragraphs: DocumentParagraph[];
  /** A zero span is Univer's covered-cell marker for a merged neighbor. */
  rowSpan?: number;
  columnSpan?: number;
}

export interface DocumentTableRow {
  cells: DocumentTableCell[];
}

export interface DocumentTable {
  id: string;
  rows: DocumentTableRow[];
  /** Editor-space widths. The OOXML adapter converts these to and from twips. */
  columnWidths?: number[];
}

export type DocumentContent =
  | { kind: "paragraph"; paragraph: DocumentParagraph }
  | { kind: "table"; table: DocumentTable }
  | { kind: "image"; image: DocumentImage };

export interface EditableDocument {
  id: string;
  title: string;
  content: DocumentContent[];
}

export function blankDocumentDraft(): DocumentDraft {
  return {
    title: "",
  };
}
