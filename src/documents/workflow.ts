import { userFileName } from "../lib/fileKind";
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

export function namedDocumentFileName(title: string, extension: string, now = Date.now()): string {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!safeExtension) throw new Error("document encoder did not provide a valid extension");
  const stem = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/g, "");
  return `${stem || "document"}-${now}.${safeExtension}`;
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

/** Create a populated, meaningfully named document without giving a caller a
 * filesystem path. The repository remains responsible for the managed lane. */
export async function createNamedDocument(
  dependencies: CreateDocumentDependencies,
  title: string,
  draft: DocumentDraft,
  now = Date.now(),
): Promise<string> {
  const base64 = await dependencies.encoder.encode(draft);
  return dependencies.repository.create(
    namedDocumentFileName(title, dependencies.encoder.extension, now),
    base64,
  );
}

/** Create a blank document under the name a person typed — the filename IS its
 * name (no timestamp). A blank name is refused before anything is encoded. */
export async function createUserNamedDocument(
  dependencies: CreateDocumentDependencies,
  name: string,
  draft: DocumentDraft = blankDocumentDraft(),
): Promise<string> {
  const fileName = userFileName(name, dependencies.encoder.extension.toLowerCase());
  const base64 = await dependencies.encoder.encode(draft);
  return dependencies.repository.create(fileName, base64);
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
      save(next: EditableDocument): Promise<string>;
    };

/** Open one local editing session around the ORIGINAL package. Save mutates the
 * modeled Word body while the codec preserves unrelated OOXML package parts. */
export async function editDocument<Source>(
  dependencies: EditDocumentDependencies<Source>,
  fileId: string,
): Promise<DocumentEditingOutcome> {
  const stat = await dependencies.reader.stat(fileId);
  if (stat && stat.len > dependencies.maxBytes) return { kind: "too-large" };
  if (!stat) throw new Error("The document is unavailable.");
  const base64 = await dependencies.reader.readBase64(fileId, dependencies.maxBytes + 1);
  const decoded = await dependencies.codec.decode(base64, fileId);
  let revision = stat.revision;
  return {
    kind: "ready",
    document: decoded.document,
    warnings: decoded.warnings,
    save: async (next) => {
      const encoded = await dependencies.codec.encode(decoded.source, next);
      revision = await dependencies.writer.writeBase64(fileId, encoded, true, revision);
      return revision;
    },
  };
}
