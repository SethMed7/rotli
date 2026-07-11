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

export function blankDocumentDraft(): DocumentDraft {
  return {
    title: "Untitled document",
    subtitle: "Created in Rotli",
    blocks: [
      {
        kind: "paragraph",
        text: "Use Zoom in to work with this document without leaving the note, or Open in tab for a dedicated preview. Edit the source file in Word, Pages, or LibreOffice.",
      },
    ],
  };
}
