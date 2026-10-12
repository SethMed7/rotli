import { DOCUMENT_EXTS, DOCUMENT_OPEN_WITH_APPS } from "../documents/kinds";
import * as sheetKinds from "../sheets/kinds";
import { IMAGE_EXTS, VIDEO_EXTS, extOf } from "./fileKind";

export type FileKind = "audio" | "video" | "image" | "pdf" | "sheet" | "document" | "text" | "html" | "other";

/** Slot at the end of the file header for the sheet's own controls (Raw / Save). */

const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "oga", "opus"]);
const VIDEO = VIDEO_EXTS;
// the image viewer handles svg/ico too, so it broadens the shared raster set.
const IMAGE = new Set([...IMAGE_EXTS, "svg", "ico"]);
// html gets its own two-mode kind (Preview ⇄ Code) — it used to sit in TEXT.
const HTML = new Set(["html", "htm", "xhtml"]);
const TEXT = new Set(["txt", "text", "log", "json", "md", "markdown", "yaml", "yml", "xml", "vtt", "srt"]);

// exceljs only round-trips real .xlsx; csv is the values-only text path. The
// rest of the sheet family (xls/xlsm/ods/tsv) stays the read-only viewer.

// which installed "Open with …" apps make sense per kind (Rust reports what exists)
export const OPEN_WITH_BY_KIND: Record<FileKind, string[]> = {
  sheet: ["Numbers", "Microsoft Excel"],
  document: [...DOCUMENT_OPEN_WITH_APPS],
  text: ["TextEdit"],
  html: ["Safari", "TextEdit"],
  image: ["Preview"],
  pdf: ["Preview"],
  audio: [],
  video: [],
  other: [],
};

/** Exported for tests — the pure ext → viewer-kind decision. */
export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (sheetKinds.SHEET_TEXT.has(ext) || sheetKinds.SHEET_BIN.has(ext)) return "sheet";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  if (HTML.has(ext)) return "html";
  if (TEXT.has(ext) || name.toLowerCase().endsWith(".audio.txt")) return "text";
  return "other";
}
