/**
 * Document composition root. This is the only module allowed to join Tauri
 * storage with concrete DOCX adapters and application use cases.
 */
import { corpusCreateManagedFile, corpusFileBytes, corpusFileStat } from "../lib/tauri";
import { DOCUMENT_PREVIEW_MAX_BYTES } from "./kinds";
import { blankDocumentDraft } from "./model";
import type { DocumentFileReader, DocumentRepository } from "./ports";
import { createDocument, previewDocument } from "./workflow";

const repository: DocumentRepository = {
  create: corpusCreateManagedFile,
};

const reader: DocumentFileReader = {
  stat: corpusFileStat,
  readBase64: corpusFileBytes,
};

export async function createManagedDocument(now = Date.now()): Promise<string> {
  const { docxEncoder } = await import("./create");
  return createDocument({ encoder: docxEncoder, repository }, blankDocumentDraft(), now);
}

export async function previewManagedDocument(fileId: string) {
  const { docxPreviewer } = await import("./preview");
  return previewDocument(
    { reader, previewer: docxPreviewer, maxBytes: DOCUMENT_PREVIEW_MAX_BYTES },
    fileId,
  );
}
