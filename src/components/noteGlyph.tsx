// The row mark for a note, board, or file (split from glyphs.tsx, 2026-10-06,
// when the canvas mark joined): the real format mark for a file by its
// extension, the Excalidraw logo for a board, two joined cards for a JSON
// Canvas, and the plain document for everything else.

import type { ReactNode } from "react";

import { DOCUMENT_EXTS, WORD_EXTS } from "../documents/kinds";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { IMAGE_EXTS, extOf, isCanvasPath } from "../lib/fileKind";
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
    if (DOCUMENT_EXTS.has(ext)) return <DocumentGlyph {...props} />;
    if (IMAGE_EXTS.has(ext)) return <ImageGlyph {...props} />;
  }
  return <FileGlyph {...props} />;
}
