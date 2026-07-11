// Word/document file kinds shared by the file viewer, slash picker, embeds,
// and row glyphs. DOCX-family packages can be previewed locally; older binary
// formats remain managed/openable files but need their native editor.

export const DOCX_PREVIEW_EXTS = ["docx", "docm", "dotx", "dotm"] as const;
export const DOCUMENT_NATIVE_ONLY_EXTS = ["doc", "dot", "odt", "pages", "rtf"] as const;

export const DOCX_PREVIEW = new Set<string>(DOCX_PREVIEW_EXTS);
export const DOCUMENT_EXTS = new Set<string>([
  ...DOCX_PREVIEW_EXTS,
  ...DOCUMENT_NATIVE_ONLY_EXTS,
]);

export const DOCUMENT_CREATE_EXTENSION = "docx";
export const DOCUMENT_OPEN_WITH_APPS = ["Microsoft Word", "Pages", "LibreOffice"] as const;
export const DOCUMENT_SEARCH_KEYWORDS = ["word", ...DOCUMENT_EXTS] as const;

export const DOCUMENT_PREVIEW_MAX_BYTES = 12_000_000;

export function isDocumentExt(ext: string): boolean {
  return DOCUMENT_EXTS.has(ext.toLowerCase());
}

export function isDocxPreviewExt(ext: string): boolean {
  return DOCX_PREVIEW.has(ext.toLowerCase());
}
