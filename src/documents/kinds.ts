// Word/document file kinds shared by the file viewer, slash picker, embeds,
// and row glyphs. DOCX-family packages are editable locally; older binary
// formats remain managed/openable files but need conversion to DOCX first.

export const DOCX_EDITABLE_EXTS = ["docx", "docm", "dotx", "dotm"] as const;
export const DOCUMENT_NATIVE_ONLY_EXTS = ["doc", "dot", "odt", "pages", "rtf"] as const;
export const DOCUMENT_CONVERTIBLE_EXTS = ["doc", "rtf", "odt"] as const;

export const DOCX_EDITABLE = new Set<string>(DOCX_EDITABLE_EXTS);
export const DOCUMENT_CONVERTIBLE = new Set<string>(DOCUMENT_CONVERTIBLE_EXTS);
export const DOCUMENT_EXTS = new Set<string>([
  ...DOCX_EDITABLE_EXTS,
  ...DOCUMENT_NATIVE_ONLY_EXTS,
]);

export const DOCUMENT_CREATE_EXTENSION = "docx";
export const DOCUMENT_OPEN_WITH_APPS = ["Microsoft Word", "Pages", "LibreOffice"] as const;
export const DOCUMENT_SEARCH_KEYWORDS = ["word", "document", ...DOCX_EDITABLE_EXTS] as const;

export const DOCUMENT_EDIT_MAX_BYTES = 12_000_000;

export function isDocumentExt(ext: string): boolean {
  return DOCUMENT_EXTS.has(ext.toLowerCase());
}

export function isEditableDocxExt(ext: string): boolean {
  return DOCX_EDITABLE.has(ext.toLowerCase());
}
