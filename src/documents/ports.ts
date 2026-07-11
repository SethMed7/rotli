import type { DocumentDraft } from "./model";

/** Output adapter for any shareable document encoding (DOCX today). */
export interface DocumentEncoder {
  readonly extension: string;
  encode(draft: DocumentDraft): Promise<string>;
}

/** Storage boundary. Application code never knows whether Tauri or another host writes it. */
export interface DocumentRepository {
  create(name: string, base64: string): Promise<string>;
}

export interface DocumentFileReader {
  stat(id: string): Promise<{ len: number } | null>;
  readBase64(id: string, maxBytes: number): Promise<string>;
}

export interface DocumentPreviewContent {
  srcDoc: string;
  warnings: string[];
}

/** Replaceable local preview adapter (Mammoth today, never visible to the UI). */
export interface DocumentPreviewer {
  preview(base64: string): Promise<DocumentPreviewContent>;
}
