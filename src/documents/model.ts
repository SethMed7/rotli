/** Framework-free document concepts shared by every editor and file adapter. */

export interface DocumentBlock {
  kind: "paragraph" | "heading";
  text: string;
  level?: 1 | 2 | 3;
}

export interface DocumentDraft {
  title: string;
  subtitle?: string;
  blocks?: DocumentBlock[];
  table?: string[][];
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

export interface EditableDocument {
  id: string;
  title: string;
  paragraphs: DocumentParagraph[];
}

export function blankDocumentDraft(): DocumentDraft {
  return {
    title: "",
  };
}
