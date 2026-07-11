/**
 * Document composition root. This is the only module allowed to join Tauri
 * storage with concrete DOCX adapters and application use cases.
 */
import {
  corpusCreateManagedFile,
  corpusFileBytes,
  corpusFileStat,
  corpusWriteFileBytes,
} from "../lib/tauri";
import { DOCUMENT_EDIT_MAX_BYTES } from "./kinds";
import { blankDocumentDraft } from "./model";
import type { DocumentFileReader, DocumentFileWriter, DocumentRepository } from "./ports";
import { createDocument, editDocument } from "./workflow";

const repository: DocumentRepository = {
  create: corpusCreateManagedFile,
};

const reader: DocumentFileReader = {
  stat: corpusFileStat,
  readBase64: corpusFileBytes,
};

const writer: DocumentFileWriter = {
  writeBase64: corpusWriteFileBytes,
};

export async function createManagedDocument(now = Date.now()): Promise<string> {
  const { docxEncoder } = await import("./create");
  return createDocument({ encoder: docxEncoder, repository }, blankDocumentDraft(), now);
}

export async function editManagedDocument(fileId: string) {
  const { docxEditorCodec } = await import("./codec/docx");
  return editDocument(
    { reader, writer, codec: docxEditorCodec, maxBytes: DOCUMENT_EDIT_MAX_BYTES },
    fileId,
  );
}
