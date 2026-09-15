/**
 * Document composition root. This is the only module allowed to join Tauri
 * storage with concrete DOCX adapters and application use cases.
 */
import {
  corpusConvertDocument,
  corpusCreateManagedFile,
  corpusFileBytes,
  corpusFileStat,
  corpusWriteFileBytes,
} from "../lib/tauri";
import { invalidateMemex } from "../memex/useMemex";
import { invalidateNotes } from "../services/hooks";
import { MAIN_ROOT, addNoteToMainAt } from "../services/mainTree";
import { useMainStore } from "../state/main";
import { usePanesStore } from "../state/panes";
import { convertLegacyDocument } from "./conversion";
import { documentDraftFromMarkdown } from "./fromMarkdown";
import { DOCUMENT_EDIT_MAX_BYTES } from "./kinds";
import { blankDocumentDraft, type DocumentDraft, type DocumentImage } from "./model";
import type { DocumentFileReader, DocumentFileWriter, DocumentRepository } from "./ports";
import { createDocument, createNamedDocument, createUserNamedDocument, editDocument } from "./workflow";

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

export async function createManagedDocument(now = Date.now(), name?: string): Promise<string> {
  const { docxEncoder } = await import("./create");
  return name
    ? createUserNamedDocument({ encoder: docxEncoder, repository }, name)
    : createDocument({ encoder: docxEncoder, repository }, blankDocumentDraft(), now);
}

export async function createManagedDocumentFromDraft(
  title: string,
  draft: DocumentDraft,
  now = Date.now(),
  rootId?: string,
): Promise<string> {
  const { docxEncoder } = await import("./create");
  const routedRepository: DocumentRepository = rootId
    ? { create: (name, base64) => corpusCreateManagedFile(name, base64, rootId) }
    : repository;
  return createNamedDocument({ encoder: docxEncoder, repository: routedRepository }, title, draft, now);
}

export function createManagedDocumentFromMarkdown(
  title: string,
  body: string,
  now = Date.now(),
  images: DocumentImage[] = [],
  rootId?: string,
): Promise<string> {
  return createManagedDocumentFromDraft(
    title,
    { ...documentDraftFromMarkdown(title, body), ...(images.length ? { images } : {}) },
    now,
    rootId,
  );
}

export async function editManagedDocument(fileId: string) {
  const { docxEditorCodec } = await import("./codec/docx");
  return editDocument({ reader, writer, codec: docxEditorCodec, maxBytes: DOCUMENT_EDIT_MAX_BYTES }, fileId);
}

export async function convertDocumentToManagedDocx(fileId: string): Promise<string> {
  const id = await convertLegacyDocument({ convertToManagedDocx: corpusConvertDocument }, fileId);
  await Promise.all([invalidateNotes(), invalidateMemex()]);
  const { manifest, setTree } = useMainStore.getState();
  setTree(addNoteToMainAt(manifest.tree, id, MAIN_ROOT));
  usePanesStore.getState().openFile(id, { newTab: true });
  return id;
}
