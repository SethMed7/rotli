// The chat's file tools, out of host.ts (its size ceiling): read_file, which
// gives sheets by A1 address and Word documents by numbered block, and
// edit_document, the AI's edits to a Word document it created (Rust refuses
// one a person made; src-tauri/src/ai_files.rs).

import { applyDocumentEdits, type DocumentEditAction, parseEditAction } from "../documents/aiEdit";
import { DOCX_EDITABLE } from "../documents/kinds";
import { documentIsOpen } from "../documents/session";
import { extOf } from "../lib/fileKind";
import { type ChatModelInfo, corpusFileBytes, corpusFileText, corpusList } from "../lib/tauri";
import { SHEET_BIN, SHEET_TEXT } from "../sheets/kinds";
import { workbookForAi, workbookToCsv } from "../sheets/view";
import { editableDocumentForAi } from "./artifacts";
import { looksSecret, modelIsOnDevice } from "./guard";
import type { Host } from "./types";

/** A vault file by name: the exact title first, then one that contains it. */
async function findVaultFile(query: string) {
  const { notes } = await corpusList();
  const q = query
    .toLowerCase()
    .trim()
    .replace(/^["']|["']$/g, "");
  const files = notes.filter((n) => n.kind === "file");
  return (
    files.find((n) => n.title.toLowerCase() === q) ?? files.find((n) => n.title.toLowerCase().includes(q))
  );
}

export function makeFileTools(
  model: ChatModelInfo,
  opts: { onSecureNoteRead?: () => void; isSecureContext?: () => boolean },
) {
  const tools: Pick<Host, "readFile"> & Required<Pick<Host, "editDocument">> = {
    async readFile(query: string): Promise<string> {
      const file = await findVaultFile(query);
      if (!file) return `no file matching "${query}". Use the exact filename (e.g. report.csv).`;
      const ext = extOf(file.title);
      let text: string;
      if (SHEET_BIN.has(ext)) {
        try {
          text = await workbookForAi(await corpusFileBytes(file.id), file.title);
        } catch {
          return `"${file.title}" isn't a workbook Rotli can read (damaged, or a format it doesn't open).`;
        }
      } else if (SHEET_TEXT.has(ext)) {
        text = await workbookToCsv({
          csv: await corpusFileText(file.id),
          delimiter: ext === "tsv" ? "\t" : ",",
        });
      } else if (DOCX_EDITABLE.has(ext)) {
        const { editManagedDocument } = await import("../documents/composition");
        const editable = await editManagedDocument(file.id);
        text = editable.kind === "ready" ? editableDocumentForAi(editable.document) : "";
        if (!text) return "This document is too large or has no editable text Rotli can give the model.";
      } else {
        text = await corpusFileText(file.id);
      }
      // Storage files carry no frontmatter, so they skip corpus_read_ai's
      // secure gate — apply the same policy prior chats get (audit 2026-07):
      // a remote model never receives secret-shaped file contents.
      if (!modelIsOnDevice(model) && looksSecret(text)) {
        return "blocked: this file contains secret-shaped content and cannot be sent to a remote model.";
      }
      if (modelIsOnDevice(model) && looksSecret(text)) opts?.onSecureNoteRead?.();
      return text;
    },
    async editDocument(query: string, rawActions: unknown[]): Promise<string> {
      // the same refusal as create_document: a document is not a protected note
      if (opts?.isSecureContext?.() === true) {
        return "blocked: this chat carries secure-note content, and Word documents are not protected note files.";
      }
      const actions: DocumentEditAction[] = [];
      for (const [index, raw] of rawActions.entries()) {
        const action = parseEditAction(raw);
        if (typeof action === "string") return `error: action ${index + 1}: ${action}`;
        actions.push(action);
      }
      const file = await findVaultFile(query);
      if (!file || !DOCX_EDITABLE.has(extOf(file.title))) return `no Word document matching "${query}".`;
      // an open document saves on its own (documents/session.ts): edit it once it's closed
      if (documentIsOpen(file.id)) {
        return `blocked: "${file.title}" is open in a pane. Ask the user to close it, then try again.`;
      }
      const { editAiDocument } = await import("../documents/composition");
      const editable = await editAiDocument(file.id);
      if (editable.kind !== "ready") return "error: this document is too large for Rotli to edit.";
      const next = applyDocumentEdits(editable.document, actions);
      if (typeof next === "string") return `error: ${next}. Nothing was changed.`;
      try {
        // Rust refuses a document a person made, and secret-shaped text
        await editable.save(next);
      } catch (error) {
        return `blocked: ${error instanceof Error ? error.message : String(error)}`;
      }
      const count = `${actions.length} change${actions.length === 1 ? "" : "s"}`;
      return `saved ${count} to "${file.title}" (a backup of the original was kept). It now reads:\n${editableDocumentForAi(next)}`;
    },
  };
  return tools;
}
