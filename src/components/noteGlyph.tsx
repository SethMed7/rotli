// The row mark for a note, board, or file (split from glyphs.tsx, 2026-10-06,
// when the canvas mark joined): the real format mark for a file by its
// extension, the Excalidraw logo for a board, two joined cards for a JSON
// Canvas, and the plain document for everything else.

import type { ReactNode } from "react";

import { DOCUMENT_EXTS, WORD_EXTS } from "../documents/kinds";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { IMAGE_EXTS, extOf, isCanvasPath } from "../lib/fileKind";
import { SHEET_BIN, SHEET_TEXT } from "../sheets/kinds";
import {
  DocumentGlyph,
  ExcalidrawGlyph,
  FileGlyph,
  Glyph,
  type GlyphProps,
  ImageGlyph,
  PdfGlyph,
  SvgFormatGlyph,
  WordGlyph,
} from "./glyphs";

/** A spreadsheet (xlsx, csv, tsv): a grid card in the sheet color, so a
 * workbook reads as one at a glance beside the Word mark (the owner,
 * 2026-10-10: sheets looked like plain files). */
export function SheetGlyph({ size = 15, className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="7" y="3" width="14" height="18" rx="2" fill="var(--format-sheet)" opacity="0.82" />
      <path
        d="M14 3v18M7 9h14M7 15h14"
        fill="none"
        stroke="var(--on-format-sheet)"
        strokeWidth="1.1"
        opacity="0.6"
      />
      <rect x="2" y="6" width="12" height="12" rx="1.5" fill="var(--format-sheet)" />
      <path
        d="M4.5 9.5h7v5h-7zM8 9.5v5M4.5 12h7"
        fill="none"
        stroke="var(--on-format-sheet)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A JSON Canvas: two cards and the line between them. */
export function CanvasGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="9" height="7" rx="1.5" />
      <rect x="12" y="13" width="9" height="7" rx="1.5" />
      <path d="M12 7.5h2.5a2 2 0 0 1 2 2V13" />
    </Glyph>
  );
}

/** The row glyph for a note/board/file, by kind + filename extension: the REAL
 * format mark for files (svg/pdf/raster image), the Excalidraw logo for
 * boards, two joined cards for a JSON Canvas where this build opens them;
 * notes and unknown files stay the generic document. */
export function glyphForNote(
  note: {
    kind?: "note" | "board" | "file" | undefined;
    title?: string | undefined;
    id?: string | undefined;
  },
  props?: GlyphProps,
): ReactNode {
  if (note.kind === "board") return <ExcalidrawGlyph {...props} />;
  // a listed canvas is titled without its extension, so its id says what it
  // is; a tab knows only the file name, which still carries it
  if (note.kind === "file" && LAUNCH_FEATURES.jsonCanvas && isCanvasPath(note.id ?? note.title ?? ""))
    return <CanvasGlyph {...props} />;
  if (note.kind === "file") {
    const ext = extOf(note.title ?? "");
    if (ext === "svg") return <SvgFormatGlyph {...props} />;
    if (ext === "pdf") return <PdfGlyph {...props} />;
    if (WORD_EXTS.has(ext)) return <WordGlyph {...props} />;
    if (SHEET_BIN.has(ext) || SHEET_TEXT.has(ext)) return <SheetGlyph {...props} />;
    if (DOCUMENT_EXTS.has(ext)) return <DocumentGlyph {...props} />;
    if (IMAGE_EXTS.has(ext)) return <ImageGlyph {...props} />;
  }
  return <FileGlyph {...props} />;
}
