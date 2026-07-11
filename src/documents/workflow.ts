import { blankDocumentDraft, type DocumentDraft, type EditableDocument } from "./model";
import type {
  DocumentEditorCodec,
  DocumentEncoder,
  DocumentFileReader,
  DocumentFileWriter,
  DocumentRepository,
} from "./ports";

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

export interface EditDocumentDependencies<Source> {
  reader: DocumentFileReader;
  writer: DocumentFileWriter;
  codec: DocumentEditorCodec<Source>;
  maxBytes: number;
}

export type DocumentEditingOutcome =
  | { kind: "too-large" }
  | {
      kind: "ready";
      document: EditableDocument;
      warnings: string[];
      save(next: EditableDocument): Promise<void>;
    };

/** Open one local editing session around the ORIGINAL package. Save mutates the
 * modeled Word body while the codec preserves unrelated OOXML package parts. */
export async function editDocument<Source>(
  dependencies: EditDocumentDependencies<Source>,
  fileId: string,
): Promise<DocumentEditingOutcome> {
  const stat = await dependencies.reader.stat(fileId);
  if (stat && stat.len > dependencies.maxBytes) return { kind: "too-large" };
  const base64 = await dependencies.reader.readBase64(fileId, dependencies.maxBytes + 1);
  const decoded = await dependencies.codec.decode(base64, fileId);
  return {
    kind: "ready",
    document: decoded.document,
    warnings: decoded.warnings,
    save: async (next) => {
      const encoded = await dependencies.codec.encode(decoded.source, next);
      await dependencies.writer.writeBase64(fileId, encoded, true);
    },
  };
}
