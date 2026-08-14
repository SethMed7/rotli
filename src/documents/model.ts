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
}

export interface DocumentRun {
  text: string;
  style?: DocumentTextStyle;
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
