// The chat's file tools, out of host.ts (its size ceiling): read_file, which
// gives sheets by A1 address and Word documents by numbered block, and
// edit_document, the AI's edits to a Word document it created (Rust refuses
// one a person made; src-tauri/src/ai_files.rs).

import { DOCX_EDITABLE } from "../documents/kinds";
import { extOf } from "../lib/fileKind";
import { secureByName } from "../lib/librarianRules";
import {
  type ApprovedText,
  externalText,
  fixed,
  modelText,
  type PromptText,
  prompt,
  reshapeAsync,
} from "../lib/promptText";
import {
  type ChatModelInfo,
  type CorpusNoteMeta,
  corpusList,
  corpusListFresh,
  splitRootId,
} from "../lib/tauri";
import { inSecureHome } from "../security/secureNotes";
import { SHEET_BIN, SHEET_TEXT } from "../sheets/kinds";
import { workbookForAi, workbookToCsv } from "../sheets/view";
import { useLibrarianRules } from "../state/librarianRules";
import { useUiStore } from "../state/ui";
import {
  type Approved,
  approvedDocumentEdit,
  approvedFileRows,
  approvedFileBytes,
  approvedFileText,
  approvedManagedDocumentText,
} from "./approvedRead";
import { looksSecret, modelIsOnDevice } from "./guard";
import type { Host } from "./types";

/** Narrow file-read port keeps host tests independent of process-wide module mocks. */
export interface FileToolIo {
  corpusList: () => Promise<{ notes: Pick<CorpusNoteMeta, "id" | "title" | "kind">[] }>;
  corpusListFresh: () => Promise<{ notes: Pick<CorpusNoteMeta, "id" | "title" | "kind">[] }>;
  /** The files a model may name, from the AI file lane: what the file tools
   * resolve against, so a name a model sees came through the gate. */
  files: (reader: ChatModelInfo) => Promise<Pick<Approved<CorpusNoteMeta>, "id" | "title" | "kind">[]>;
  /** The gated AI file lane (ai/approvedRead.ts): what a model may receive. */
  fileBytes: typeof approvedFileBytes;
  fileText: typeof approvedFileText;
  documentText: typeof approvedManagedDocumentText;
  editDocument: typeof approvedDocumentEdit;
}

const defaultFileToolIo: FileToolIo = {
  corpusList: () => corpusList(),
  corpusListFresh: () => corpusListFresh(),
  files: approvedFileRows,
  fileBytes: approvedFileBytes,
  fileText: approvedFileText,
  documentText: approvedManagedDocumentText,
  editDocument: approvedDocumentEdit,
};

/** The one file `query` names among `files`: an exact id/path, or an
 * unambiguous exact filename. */
function matchFile<F extends { id: string; title: string; kind?: string | undefined }>(
  files: readonly F[],
  query: string,
): F | undefined {
  const q = query.trim().replace(/^["']|["']$/g, "");
  const exact = q.startsWith("storage:") ? `storage/${q.slice("storage:".length)}` : q;
  const candidates = files.filter((n) => n.kind === "file");
  const matches =
    exact.includes("/") || exact.includes(":")
      ? candidates.filter((n) => n.id === exact)
      : candidates.filter((n) => n.title.toLowerCase() === exact.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolve a file in the person's own listing (for an access decision only:
 * nothing from it reaches a model). */
async function findVaultFile(query: string, fresh = false, io: FileToolIo = defaultFileToolIo) {
  const { notes } = await (fresh ? io.corpusListFresh() : io.corpusList());
  return matchFile(notes, query);
}

/** Resolve a file a model named, in the AI file lane's listing for it. */
async function findApprovedFile(query: string, model: ChatModelInfo, io: FileToolIo) {
  return matchFile(await io.files(model), query);
}

export function aiPathIsProtected(rel: string, title: string): boolean {
  return inSecureHome(rel) || secureByName(title, rel, useLibrarianRules.getState().rules.secureKeywords);
}

function fileIsProtected(file: { id: string; title: string }): boolean {
  const { rel } = splitRootId(file.id);
  return aiPathIsProtected(rel, file.title);
}

/** Every chat file tool must pass this before any read, decode, or edit. */
function fileAccess(file: { id: string; title: string } | undefined, local: boolean): string | null {
  if (!file) return "blocked: the exact file cannot be resolved safely.";
  if (!fileIsProtected(file)) return null;
  if (!local) return "blocked: a secure file cannot be sent to a remote model.";
  if (!useUiStore.getState().secureLocalAi)
    return "blocked: local AI access to secure files is off for this vault.";
  return null;
}

/** Exact-id form for AI workflows that embed a previously generated file. */
export async function aiFileAccessById(
  id: string,
  local: boolean,
  io: FileToolIo = defaultFileToolIo,
): Promise<string | null> {
  let file = await findVaultFile(id, false, io);
  if (!file) file = await findVaultFile(id, true, io);
  return file?.id === id ? fileAccess(file, local) : "blocked: the exact file cannot be resolved safely.";
}

export function makeFileTools(
  model: ChatModelInfo,
  opts: { onSecureNoteRead?: () => void; isSecureContext?: () => boolean },
  io: FileToolIo = defaultFileToolIo,
) {
  const tools: Pick<Host, "readFile"> & Required<Pick<Host, "editDocument">> = {
    async readFile(query: string): Promise<ApprovedText | PromptText> {
      const file = await findApprovedFile(query, model, io);
      if (!file) return fixed("blocked: the exact file cannot be resolved safely.");
      const refusal = fileAccess(file, modelIsOnDevice(model));
      if (refusal) return prompt`${externalText(refusal)}`;
      const protectedFile = fileIsProtected(file);
      const name = file.title;
      const ext = extOf(file.title);
      let text: ApprovedText;
      if (SHEET_BIN.has(ext)) {
        try {
          text = await reshapeAsync(await io.fileBytes(file.id, model), (base64) =>
            workbookForAi(base64, file.title),
          );
        } catch {
          return prompt`"${name}" isn't a workbook Rotli can read (damaged, or a format it doesn't open).`;
        }
      } else if (SHEET_TEXT.has(ext)) {
        text = await reshapeAsync(await io.fileText(file.id, model), (csv) =>
          workbookToCsv({ csv, delimiter: ext === "tsv" ? "\t" : "," }),
        );
      } else if (DOCX_EDITABLE.has(ext)) {
        const editable = await io.documentText(file.id, model);
        if (!editable)
          return fixed("This document is too large or has no editable text Rotli can give the model.");
        text = editable;
      } else {
        text = await io.fileText(file.id, model);
      }
      // Storage files carry no frontmatter, so they skip corpus_read_ai's
      // secure gate — apply the same policy prior chats get (audit 2026-07):
      // a remote model never receives secret-shaped file contents.
      if (!modelIsOnDevice(model) && looksSecret(text)) {
        return fixed(
          "blocked: this file contains secret-shaped content and cannot be sent to a remote model.",
        );
      }
      if (modelIsOnDevice(model) && (looksSecret(text) || protectedFile)) opts?.onSecureNoteRead?.();
      return text;
    },
    async editDocument(query: string, rawActions: unknown[]): Promise<PromptText> {
      // the same refusal as create_document: a document is not a protected note
      if (opts?.isSecureContext?.() === true) {
        return fixed(
          "blocked: this chat carries secure-note content, and Word documents are not protected note files.",
        );
      }
      const file = await findApprovedFile(query, model, io);
      const refusal = fileAccess(file, modelIsOnDevice(model));
      if (refusal) return prompt`${externalText(refusal)}`;
      if (!file || !DOCX_EDITABLE.has(extOf(file.title)))
        return prompt`no Word document matching "${modelText(query)}".`;
      if (modelIsOnDevice(model) && fileIsProtected(file)) {
        opts?.onSecureNoteRead?.();
      }
      const edit = await io.editDocument(file, rawActions, model);
      if (edit.kind === "refused") return prompt`${externalText(edit.reason)}`;
      return prompt`saved ${edit.count} change${edit.count === 1 ? "" : "s"} to "${file.title}" (a backup of the original was kept). It now reads:\n${edit.text}`;
    },
  };
  return tools;
}
