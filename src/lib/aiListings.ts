// The AI listing lanes added in the third review of pull request 267, beside
// lib/tauri.ts so it stays within its size ratchet: the files a model may name
// (corpus_files_ai) and what the Librarian's prompt is built from besides the
// open note (corpus_librarian_ai). Both are gated in Rust for the model given;
// ai/approvedRead.ts is their only caller and approves what they return.

import { invoke } from "@tauri-apps/api/core";

import { type ChatModelInfo, type CorpusFolder, type CorpusNoteMeta, isTauri } from "./tauri";

/** The files (kind "file") this model may name, from their paths in the AI
 * file lane, gated in Rust; nothing is read. Rotli Web has no file lane. */
export async function corpusFilesAi(
  model: Pick<ChatModelInfo, "id" | "endpoint">,
): Promise<CorpusNoteMeta[]> {
  if (!isTauri()) return [];
  return invoke<CorpusNoteMeta[]>("corpus_files_ai", { modelId: model.id, endpoint: model.endpoint });
}

/** What the Librarian's prompt is built from besides the open note: the
 * vault's directories and its People notes, gated in Rust for this model
 * (only People notes are read). The Librarian refuses in Rotli Web. */
export interface LibrarianListing {
  folders: CorpusFolder[];
  people: CorpusNoteMeta[];
}
export async function corpusLibrarianAi(
  model: Pick<ChatModelInfo, "id" | "endpoint">,
): Promise<LibrarianListing> {
  if (!isTauri()) return { folders: [], people: [] };
  return invoke<LibrarianListing>("corpus_librarian_ai", { modelId: model.id, endpoint: model.endpoint });
}
