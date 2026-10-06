// Ask AI (`/ai`, 2026-10-05) — the gates around the one model call and the one
// write. Ask: the note's protection is read (locked or an explicit "no" stops
// it before any model runs), the note is read through the AI read gate for
// THIS model (a secure note never reaches a remote one), and only that read is
// sent. Insert: the person chose the answer; the note is flushed and read
// again (a Librarian write may have moved its revision), and Rust's
// corpus_insert_ai checks the write is that answer and nothing else.

import { type InlineVerdict, askInline } from "../ai/inlineAi";
import type { Host } from "../ai/types";
import { flushNote, reloadDocumentIfClean } from "../editor/model";
import { consentedInsertRefusal } from "../lib/aiEditPolicy";
import { corpusInsertAi } from "../lib/aiInsert";
import {
  type ChatModelInfo,
  type FrontmatterView,
  corpusFrontmatter,
  corpusReadAiVersioned,
} from "../lib/tauri";
import { invalidateNotes } from "./hooks";

type Model = Pick<ChatModelInfo, "id" | "endpoint">;

export interface InlineAiDeps {
  flush: (noteId: string) => Promise<void>;
  frontmatter: (noteId: string) => Promise<FrontmatterView | null>;
  /** The AI read gate for this model: the file, its revision, and the editor body. */
  read: (noteId: string, model: Model) => Promise<{ revision: string; editor?: string }>;
  insert: (
    noteId: string,
    body: string,
    text: string,
    model: Model,
    revision: string,
  ) => Promise<{ revision: string }>;
  /** Show the written body in the open editor at once, then refresh lists. */
  adopt: (noteId: string, body: string, revision: string) => void;
}

export const INLINE_AI_DEPS: InlineAiDeps = {
  flush: flushNote,
  frontmatter: corpusFrontmatter,
  read: (noteId, model) => corpusReadAiVersioned(noteId, model, { withEditor: true }),
  insert: corpusInsertAi,
  adopt: (noteId, body, revision) => {
    reloadDocumentIfClean(noteId, body, revision);
    void invalidateNotes();
  },
};

const STILL_SAVING = "The note is still saving. Try again in a moment.";
const PROTECTION_UNREADABLE = "This note’s protection couldn’t be read, so nothing was sent or written.";

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message || "Something went wrong.";
}

/** Whether the person's consent may land here at all (lock, explicit no). */
async function refusalFor(deps: InlineAiDeps, noteId: string): Promise<string | null> {
  const frontmatter = await deps.frontmatter(noteId).catch(() => null);
  if (!frontmatter) return PROTECTION_UNREADABLE;
  return consentedInsertRefusal(frontmatter.aiBodyEdit);
}

/** The note as the read gate returns it for this model — the only text a
 * model may see — when it still matches what the editor shows. */
async function gatedRead(
  deps: InlineAiDeps,
  noteId: string,
  model: Model,
  docText: string,
): Promise<{ ok: true; revision: string } | { ok: false; reason: string }> {
  await deps.flush(noteId);
  let read: { revision: string; editor?: string };
  try {
    read = await deps.read(noteId, model);
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
  // the editor must show exactly what the gate let this model read (the
  // editor reads a CRLF note with LF line endings)
  const gated = read.editor?.replace(/\r\n/g, "\n");
  return gated === docText ? { ok: true, revision: read.revision } : { ok: false, reason: STILL_SAVING };
}

/** Ask the model for a passage at `at` in the note's text. Nothing is written. */
export async function askAtCursor(
  deps: InlineAiDeps,
  host: Pick<Host, "complete">,
  model: Model,
  noteId: string,
  ask: string,
  docText: string,
  at: number,
): Promise<InlineVerdict> {
  const refusal = await refusalFor(deps, noteId);
  if (refusal) return { ok: false, reason: refusal };
  const read = await gatedRead(deps, noteId, model, docText);
  if (!read.ok) return read;
  return askInline(host, ask, docText.slice(0, at), docText.slice(at));
}

/** Write the accepted passage at `at`. `text` is exactly what the person saw. */
export async function insertAtCursor(
  deps: InlineAiDeps,
  model: Model,
  noteId: string,
  text: string,
  docText: string,
  at: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const refusal = await refusalFor(deps, noteId);
  if (refusal) return { ok: false, reason: refusal };
  const read = await gatedRead(deps, noteId, model, docText);
  if (!read.ok) return read;
  const body = docText.slice(0, at) + text + docText.slice(at);
  try {
    const written = await deps.insert(noteId, body, text, model, read.revision);
    deps.adopt(noteId, body, written.revision);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}
