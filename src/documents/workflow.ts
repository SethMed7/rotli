import { blankDocumentDraft, type DocumentDraft } from "./model";
import type { DocumentEncoder, DocumentFileReader, DocumentPreviewer, DocumentRepository } from "./ports";

export interface CreateDocumentDependencies {
  encoder: DocumentEncoder;
  repository: DocumentRepository;
}

export function documentFileName(extension: string, now = Date.now()): string {
  const safe = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!safe) throw new Error("document encoder did not provide a valid extension");
  return `untitled-${now}.${safe}`;
}

/** Create-document use case. Framework and file-format details arrive through ports. */
export async function createDocument(
  dependencies: CreateDocumentDependencies,
  draft: DocumentDraft = blankDocumentDraft(),
  now = Date.now(),
): Promise<string> {
  const base64 = await dependencies.encoder.encode(draft);
  return dependencies.repository.create(documentFileName(dependencies.encoder.extension, now), base64);
}

export type DocumentPreviewOutcome =
  | { kind: "ready"; srcDoc: string; warnings: string[] }
  | { kind: "too-large" };

export interface PreviewDocumentDependencies {
  reader: DocumentFileReader;
  previewer: DocumentPreviewer;
  maxBytes: number;
}

/** Read/limit/preview orchestration kept outside both React and the parser adapter. */
export async function previewDocument(
  dependencies: PreviewDocumentDependencies,
  fileId: string,
): Promise<DocumentPreviewOutcome> {
  const stat = await dependencies.reader.stat(fileId);
  if (stat && stat.len > dependencies.maxBytes) return { kind: "too-large" };
  const base64 = await dependencies.reader.readBase64(fileId, dependencies.maxBytes + 1);
  return { kind: "ready", ...(await dependencies.previewer.preview(base64)) };
}
