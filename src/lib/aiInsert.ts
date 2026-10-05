// The `/ai` insert lane (2026-10-05, src-tauri/src/corpus_ai_edit.rs): the one
// AI write that needs the person's Insert instead of the standing grant, and in
// exchange may only ADD the accepted passage. Desktop only — Rotli Web has no
// insert lane, and its replace policy would refuse a person's note in the
// wrong words.

import { invoke } from "@tauri-apps/api/core";

import { type ChatModelInfo, type CorpusWriteResult, isTauri } from "./tauri";

/** `body` must be the note's current editor body plus exactly `text` at one
 * place. Rust checks that, then runs the AI write lane in Insert mode: the
 * read gate, the lock, an explicit `ai_edit: false`, the laundering rule, the
 * revision, and an `inline` journal row. */
export function corpusInsertAi(
  id: string,
  body: string,
  text: string,
  model: Pick<ChatModelInfo, "id" | "endpoint">,
  expectedRevision: string,
): Promise<CorpusWriteResult> {
  if (!isTauri()) return Promise.reject(new Error("Ask AI runs in the Mac app."));
  return invoke<CorpusWriteResult>("corpus_insert_ai", {
    id,
    body,
    text,
    modelId: model.id,
    endpoint: model.endpoint,
    expectedRevision,
  });
}
