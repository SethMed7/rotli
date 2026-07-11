import type { DocumentDraft, EditableDocument } from "./model";

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

export interface DocumentFileWriter {
  writeBase64(id: string, base64: string, backup: boolean): Promise<void>;
}

export interface DecodedDocument<Source> {
  source: Source;
  document: EditableDocument;
  warnings: string[];
}

/** Local format adapter. Source remains adapter-owned (the original OOXML
 * package for DOCX), while the application and editor exchange only the clean
 * document model. */
export interface DocumentEditorCodec<Source> {
  decode(base64: string, fileId: string): Promise<DecodedDocument<Source>>;
  encode(source: Source, document: EditableDocument): Promise<string>;
}
