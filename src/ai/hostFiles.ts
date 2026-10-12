// The chat's file tools, out of host.ts (its size ceiling): read_file, which
// gives sheets by A1 address and Word documents by numbered block, and
// edit_document, the AI's edits to a Word document it created (Rust refuses
// one a person made; src-tauri/src/ai_files.rs).

import { DOCX_EDITABLE } from "../documents/kinds";
import { extOf } from "../lib/fileKind";
import { secureByName } from "../lib/librarianRules";
import {
  type ChatModelInfo,
  corpusFileBytesAi,
  corpusFileTextAi,
  corpusList,
  corpusListFresh,
  splitRootId,
} from "../lib/tauri";
import { inSecureHome } from "../security/secureNotes";
import { SHEET_BIN, SHEET_TEXT } from "../sheets/kinds";
import { workbookForAi, workbookToCsv } from "../sheets/view";
import { useLibrarianRules } from "../state/librarianRules";
import { useUiStore } from "../state/ui";
import { editableDocumentForAi } from "./artifacts";
import { editDocumentAsAi } from "./documentEdits";
import { looksSecret, modelIsOnDevice } from "./guard";
import type { Host } from "./types";

/** Resolve an exact id/path, or an unambiguous exact filename. */
async function findVaultFile(query: string, fresh = false) {
  const { notes } = await (fresh ? corpusListFresh() : corpusList());
  const q = query.trim().replace(/^["']|["']$/g, "");
  const exact = q.startsWith("storage:") ? `storage/${q.slice("storage:".length)}` : q;
  const files = notes.filter((n) => n.kind === "file");
  const matches =
    exact.includes("/") || exact.includes(":")
      ? files.filter((n) => n.id === exact)
      : files.filter((n) => n.title.toLowerCase() === exact.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export function aiPathIsProtected(rel: string, title: string): boolean {
  return inSecureHome(rel) || secureByName(title, rel, useLibrarianRules.getState().rules.secureKeywords);
}

function fileIsProtected(file: NonNullable<Awaited<ReturnType<typeof findVaultFile>>>): boolean {
  const { rel } = splitRootId(file.id);
  return aiPathIsProtected(rel, file.title);
}

/** Every chat file tool must pass this before any read, decode, or edit. */
function fileAccess(file: Awaited<ReturnType<typeof findVaultFile>>, local: boolean): string | null {
  if (!file) return "blocked: the exact file cannot be resolved safely.";
  if (!fileIsProtected(file)) return null;
  if (!local) return "blocked: a secure file cannot be sent to a remote model.";
  if (!useUiStore.getState().secureLocalAi)
    return "blocked: local AI access to secure files is off for this vault.";
  return null;
}

/** Exact-id form for AI workflows that embed a previously generated file. */
export async function aiFileAccessById(id: string, local: boolean): Promise<string | null> {
  let file = await findVaultFile(id);
  if (!file) file = await findVaultFile(id, true);
  return file?.id === id ? fileAccess(file, local) : "blocked: the exact file cannot be resolved safely.";
}

export function makeFileTools(
  model: ChatModelInfo,
  opts: { onSecureNoteRead?: () => void; isSecureContext?: () => boolean },
) {
  const tools: Pick<Host, "readFile"> & Required<Pick<Host, "editDocument">> = {
    async readFile(query: string): Promise<string> {
      const file = await findVaultFile(query);
      if (!file) return "blocked: the exact file cannot be resolved safely.";
      const refusal = fileAccess(file, modelIsOnDevice(model));
      if (refusal) return refusal;
      const protectedFile = fileIsProtected(file);
      const ext = extOf(file.title);
      let text: string;
      if (SHEET_BIN.has(ext)) {
        try {
          text = await workbookForAi(await corpusFileBytesAi(file.id, model), file.title);
        } catch {
          return `"${file.title}" isn't a workbook Rotli can read (damaged, or a format it doesn't open).`;
        }
      } else if (SHEET_TEXT.has(ext)) {
        text = await workbookToCsv({
          csv: await corpusFileTextAi(file.id, model),
          delimiter: ext === "tsv" ? "\t" : ",",
        });
      } else if (DOCX_EDITABLE.has(ext)) {
        const { readAiManagedDocument } = await import("../documents/composition");
        const editable = await readAiManagedDocument(file.id, model);
        text = editable.kind === "ready" ? editableDocumentForAi(editable.document) : "";
        if (!text) return "This document is too large or has no editable text Rotli can give the model.";
      } else {
        text = await corpusFileTextAi(file.id, model);
      }
      // Storage files carry no frontmatter, so they skip corpus_read_ai's
      // secure gate — apply the same policy prior chats get (audit 2026-07):
      // a remote model never receives secret-shaped file contents.
      if (!modelIsOnDevice(model) && looksSecret(text)) {
        return "blocked: this file contains secret-shaped content and cannot be sent to a remote model.";
      }
      if (modelIsOnDevice(model) && (looksSecret(text) || protectedFile)) opts?.onSecureNoteRead?.();
      return text;
    },
    async editDocument(query: string, rawActions: unknown[]): Promise<string> {
      // the same refusal as create_document: a document is not a protected note
      if (opts?.isSecureContext?.() === true) {
        return "blocked: this chat carries secure-note content, and Word documents are not protected note files.";
      }
      const file = await findVaultFile(query);
      const refusal = fileAccess(file, modelIsOnDevice(model));
      if (refusal) return refusal;
      if (!file || !DOCX_EDITABLE.has(extOf(file.title))) return `no Word document matching "${query}".`;
      if (modelIsOnDevice(model) && fileIsProtected(file)) {
        opts?.onSecureNoteRead?.();
      }
      const edit = await editDocumentAsAi(file, rawActions, model);
      if (edit.kind === "refused") return edit.reason;
      const count = `${edit.count} change${edit.count === 1 ? "" : "s"}`;
      return `saved ${count} to "${file.title}" (a backup of the original was kept). It now reads:\n${editableDocumentForAi(edit.document)}`;
    },
  };
  return tools;
}
