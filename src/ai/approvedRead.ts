// The gated reads a model's context may come from, and the only place note-
// derived text becomes `ApprovedText` (lib/promptText.ts). Every function here
// asks Rust's AI read gate (or Rotli Web's AI corpus, its twin) for the model
// that will read the answer, and brands exactly what that gate returned:
// nothing from notesService, the UI note index, or a cache. A model request can
// carry note-derived text only as ApprovedText, so a path that skips these
// reads fails to compile (third review of pull request 267).

import { rankChatMemories } from "../chatMemory/retrieval";
import { corpusFilesAi, corpusLibrarianAi } from "../lib/aiListings";
import { type Attachments, buildHandToAiPrompt } from "../lib/handToAi";
import type { Approved, ApprovedText } from "../lib/promptText";

export type { Approved } from "../lib/promptText";
import { type PersonNote, peopleNotes } from "../lib/librarianPeople";
import {
  type ChatModelInfo,
  type CorpusNoteMeta,
  corpusFileBytesAi,
  corpusFileTextAi,
  corpusNotesAi,
  corpusReadAiVersioned,
  corpusSearchAi,
  isTauri,
} from "../lib/tauri";
import { currentWebAiCorpus } from "../lib/webAiSeam";
import type { MemexInstance } from "../memex/config";
import { hasSecureContext } from "../memex/contract";
import { buildModelMap, type ModelMapNote } from "../memex/modelMap";
import { listChats, readChat } from "../memex/service";
import { titleOf } from "../services/derive";
import type { SearchHit } from "../types";
import { editableDocumentForAi } from "./artifacts";
import { editDocumentAsAi } from "./documentEdits";
import { looksSecret, modelIsOnDevice } from "./guard";

type Reader = Pick<ChatModelInfo, "id" | "endpoint">;

/** The one constructor. Never exported. */
const approve = (text: string): ApprovedText => text as ApprovedText;

function approveRow<T extends object>(row: T): Approved<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] =
      typeof value === "string"
        ? approve(value)
        : Array.isArray(value)
          ? value.map((item: unknown) => (typeof item === "string" ? approve(item) : item))
          : value;
  }
  return out as Approved<T>;
}

/** A note as the gate approved it for one reader: the id and revision it was
 * approved for, and the title and words of that very read. */
export interface ApprovedNote {
  readonly id: string;
  readonly revision: string;
  /** The whole file the gate judged (frontmatter included in the Mac app). */
  readonly text: ApprovedText;
  /** The editor's copy, without frontmatter. */
  readonly body: ApprovedText;
  readonly title: ApprovedText;
  /** The gate passed it only because the reader is on-device: whatever is
   * built from it never goes to a remote model (fourth review). */
  readonly onDeviceOnly: boolean;
}

/** The gate's read of one note: Rust in the Mac app, the registered web AI
 * corpus in Rotli Web. With `browserFallback`, a browser with no connected
 * vault (the demo, the e2e harness) reads through the same web gate over the
 * notes service, as Hand to AI always has there; without it, such a browser
 * reads nothing. */
async function gatedRead(id: string, reader: Reader, browserFallback: boolean) {
  if (!browserFallback || isTauri() || currentWebAiCorpus())
    return corpusReadAiVersioned(id, reader, { withEditor: true });
  const [{ createWebAiCorpus }, { notesService }] = await Promise.all([
    import("../services/webAiCorpus"),
    import("../services/notes"),
  ]);
  return createWebAiCorpus(() => notesService).read(id);
}

/** One note through the gate for `reader`. Throws the gate's refusal. */
export async function approvedNote(
  id: string,
  reader: Reader,
  opts: { browserFallback?: boolean } = {},
): Promise<ApprovedNote> {
  const read: { body: string; revision: string; editor?: string; onDeviceOnly?: boolean } = await gatedRead(
    id,
    reader,
    opts.browserFallback === true,
  );
  const body = read.editor ?? read.body;
  return {
    id,
    revision: read.revision,
    text: approve(read.body),
    body: approve(body),
    title: approve(titleOf(body)),
    onDeviceOnly: read.onDeviceOnly === true,
  };
}

/** Hand to AI's Basic prompt for an approved note: its title and words both
 * from that one read (a title from an earlier, unflagged read once carried a
 * secure version's title into Refined's request; third review of pull request 267).
 * `attachments` are where its linked files are, found by path. */
export function approvedHandoff(note: ApprovedNote, attachments: Attachments): ApprovedText {
  return approve(buildHandToAiPrompt({ title: note.title, body: note.body, attachments }));
}

/** The tags in an approved note's own frontmatter (the same read as its words). */
export function approvedTags(note: ApprovedNote): ApprovedText[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(note.text);
  const line = match?.[1]?.split(/\r?\n/).find((field) => /^tags\s*:/.test(field)) ?? "";
  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(approve);
}

/** The Librarian's listing for `reader`: the vault's directory ids and its
 * People notes, each People row from one gated read (only those are read). */
export async function approvedLibrarianListing(
  reader: Reader,
): Promise<{ folderIds: ApprovedText[]; people: Approved<CorpusNoteMeta>[] }> {
  const listing = await corpusLibrarianAi(reader);
  return {
    folderIds: listing.folders.map((folder) => approve(folder.id)),
    people: listing.people.map(approveRow),
  };
}

/** The People notes among approved rows (names and areas cut from those
 * rows' own approved fields). */
export function approvedPeopleNotes(rows: readonly Approved<CorpusNoteMeta>[]): Approved<PersonNote>[] {
  return peopleNotes(rows).map(approveRow);
}

/** A gated listing's rows, each approved as the lane returned it. */
const rowsOf =
  (lane: (reader: Reader) => Promise<CorpusNoteMeta[]>) =>
  async (reader: Reader): Promise<Approved<CorpusNoteMeta>[]> =>
    (await lane(reader)).map(approveRow);

/** Every note `reader` may list, each row built by the gate from one read. */
export const approvedNoteRows = rowsOf(corpusNotesAi);

/** The files `reader` may name (the AI file lane's listing; nothing read). */
export const approvedFileRows = rowsOf(corpusFilesAi);

/** A search through the gate for `reader`. */
export async function approvedSearch(
  query: string,
  limit: number | undefined,
  includeReference: boolean,
  reader: Reader,
): Promise<Approved<SearchHit>[]> {
  return (await corpusSearchAi(query, limit, includeReference, reader)).map(approveRow);
}

/** A surfaced file's text through the AI file lane for `reader`. */
export async function approvedFileText(id: string, reader: Reader, maxBytes?: number): Promise<ApprovedText> {
  return approve(await corpusFileTextAi(id, reader, maxBytes));
}

/** A surfaced file's bytes (base64) through the AI file lane for `reader`. */
export async function approvedFileBytes(
  id: string,
  reader: Reader,
  maxBytes?: number,
): Promise<ApprovedText> {
  return approve(await corpusFileBytesAi(id, reader, maxBytes));
}

/** A Word document's editable text, read through the AI file lane for
 * `reader`; null when it is too large or holds no editable text. */
export async function approvedManagedDocumentText(id: string, reader: Reader): Promise<ApprovedText | null> {
  const { readAiManagedDocument } = await import("../documents/composition");
  const editable = await readAiManagedDocument(id, reader);
  const text = editable.kind === "ready" ? editableDocumentForAi(editable.document) : "";
  return text ? approve(text) : null;
}

/** The AI's edit of a Word document it made (Rust refuses one a person made),
 * and the document's text after it, read back through the same gate. */
export async function approvedDocumentEdit(
  file: { id: string; title: string },
  actions: unknown[],
  reader: Reader,
) {
  const edit = await editDocumentAsAi(file, actions, reader);
  if (edit.kind === "refused") return edit;
  return { kind: "saved" as const, count: edit.count, text: approve(editableDocumentForAi(edit.document)) };
}

/** The knowledge map for `reader`: built from the gated listing alone. */
export async function approvedKnowledgeMap(
  reader: Reader,
  contextWindow: number,
  maxChars: number,
  keep: (row: Approved<CorpusNoteMeta>) => boolean,
): Promise<{ map: ApprovedText; ids: string[]; onDeviceOnly: boolean }> {
  const rows = (await approvedNoteRows(reader)).filter(keep);
  return {
    map: approve(buildModelMap(rows as unknown as ModelMapNote[], contextWindow, maxChars)),
    ids: rows.map((row) => row.id),
    onDeviceOnly: rows.some((row) => row.onDeviceOnly === true),
  };
}

/** Memory search reads only this many newest chats, so the body cache holds no more. */
export const CHAT_MEMORY_WINDOW = 100;
type ChatBody = { modifiedMs: number; body: string };
const CHAT_BOUNDS = { entries: CHAT_MEMORY_WINDOW, chars: 8_000_000 };
const chatBodyCache = new Map<string, ChatBody>();

/** (Re)insert `key` as newest, then evict oldest-first until both bounds hold (Map order = recency). */
export function touchBounded(map: Map<string, ChatBody>, key: string, value: ChatBody, max = CHAT_BOUNDS) {
  map.delete(key);
  map.set(key, value);
  let chars = [...map.values()].reduce((sum, entry) => sum + entry.body.length, 0);
  for (const [oldest, entry] of map) {
    if (map.size <= max.entries && chars <= max.chars) return;
    map.delete(oldest);
    chars -= entry.body.length;
  }
}

/** A chat's transcript, cached by its modification time (the file is the truth). */
async function chatBody(instance: MemexInstance, slug: string, modifiedMs: number): Promise<string> {
  const key = `${instance.root}\0${slug}`;
  const cached = chatBodyCache.get(key);
  const body = cached?.modifiedMs === modifiedMs ? cached.body : await readChat(instance, slug);
  touchBounded(chatBodyCache, key, { modifiedMs, body });
  return body;
}

type ChatReader = Pick<ChatModelInfo, "id" | "endpoint" | "provider" | "api">;

/** Is a transcript protected: secret-shaped, or carrying the secure-context
 * marker (a secure note fed it)? */
const protectedChat = (text: string): boolean => looksSecret(text) || hasSecureContext(text);

/** A prior chat's transcript as memory for `reader`: refused to a remote model
 * when protected. `secure` tells an on-device reader's caller to taint. */
export async function approvedChat(
  instance: MemexInstance,
  slug: string,
  reader: ChatReader,
): Promise<{ text: ApprovedText; secure: boolean } | null> {
  const text = await readChat(instance, slug);
  const secure = protectedChat(text);
  if (secure && !modelIsOnDevice(reader)) return null;
  return { text: approve(text), secure };
}

/** Prior chats ranked as memory for `query` and `reader`, from the newest
 * CHAT_MEMORY_WINDOW transcripts: a protected chat is left out for a remote
 * model; `protectedIds` names the protected ones an on-device reader got. */
export async function approvedChatMemories(
  instance: MemexInstance,
  reader: ChatReader,
  query: string,
  limit: number,
) {
  const summaries = (await listChats(instance)).slice(0, CHAT_MEMORY_WINDOW);
  const documents = await Promise.all(
    summaries.map(async (summary) => ({
      slug: summary.slug,
      title: summary.title,
      modifiedMs: summary.modifiedMs,
      body: await chatBody(instance, summary.slug, summary.modifiedMs),
    })),
  );
  const readable = documents.filter((document) => modelIsOnDevice(reader) || !protectedChat(document.body));
  const hits = rankChatMemories(readable, query, limit).map(({ score: _score, ...hit }) => ({
    id: approve(hit.id),
    title: approve(hit.title),
    snippet: approve(hit.snippet),
    source: "chat" as const,
  }));
  const protectedIds = new Set(
    readable.filter((document) => protectedChat(document.body)).map((document) => `chat:${document.slug}`),
  );
  return { hits, protectedIds };
}
