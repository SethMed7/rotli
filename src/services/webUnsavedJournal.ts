// Rotli Web: typing is never lost to a hard refresh or a closed tab. A page
// that unloads can't finish an async file write (the File System Access API
// and Rotli Helper both are), and the editor's save waits a beat after each
// keystroke — so on `pagehide` the text of every note whose save dot is still
// dim is written SYNCHRONOUSLY to this browser's localStorage (which survives
// an unload), and the next boot writes it into the vault before the editor
// opens. The rule never overwrites: a draft lands only if its file is still the
// one it was typed against; otherwise it is kept as a separate note beside it.
//
// Privacy: localStorage is this browser, on this computer; the journal holds
// only unsaved text, only until the next boot, and is cleared as it is saved.

import type { NotesService } from "./notesPort";

const PREFIX = "rotli-unsaved:";

/** One note's unsaved text and the file revision it was typed against. */
export interface JournalDraft {
  noteId: string;
  body: string;
  expectedRevision: string;
  expectedBody: string;
}

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The journal's key for one vault. */
export function journalKey(vault: string): string {
  return `${PREFIX}${vault}`;
}

/** Where drafts a boot couldn't place wait for the next one. */
function keptKey(key: string): string {
  return `${key}:kept`;
}

/** Write (or clear) the journal now. Synchronous: this runs as the page
 * unloads, where nothing asynchronous is guaranteed to finish. */
export function writeJournal(storage: KeyValue, key: string, drafts: readonly JournalDraft[]): void {
  try {
    if (drafts.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(drafts));
  } catch {
    // storage full or blocked: the async save still races the unload
  }
}

function readJournal(storage: KeyValue, key: string): JournalDraft[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (d): d is JournalDraft =>
            typeof d === "object" &&
            d !== null &&
            typeof (d as JournalDraft).noteId === "string" &&
            typeof (d as JournalDraft).body === "string" &&
            typeof (d as JournalDraft).expectedRevision === "string" &&
            typeof (d as JournalDraft).expectedBody === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** Finish what the last page couldn't: each draft is saved onto its note when
 * the file is still the one it was typed against, skipped when the file
 * already holds it, and otherwise kept as a new note (titled from its first
 * line) so neither version is lost. Resolves the titles kept aside. */
export async function replayJournal(
  storage: KeyValue,
  key: string,
  service: Pick<NotesService, "getNote" | "updateNote" | "createNote">,
): Promise<{ saved: number; keptAside: string[]; unresolved: number }> {
  // the last unload's drafts, and any a previous boot couldn't place yet —
  // kept under their own key, which no unload ever overwrites
  const drafts = [...readJournal(storage, keptKey(key)), ...readJournal(storage, key)];
  let saved = 0;
  const keptAside: string[] = [];
  const unresolved: JournalDraft[] = [];
  for (const draft of drafts) {
    const note = await service.getNote(draft.noteId).catch(() => null);
    if (note?.body === draft.body) continue; // the unload's own save made it
    try {
      if (!note || note.revision !== draft.expectedRevision) throw new Error("changed");
      await service.updateNote(draft.noteId, draft.body, draft.expectedRevision, draft.expectedBody);
      saved += 1;
    } catch {
      const copy = await service.createNote(note?.folderId ?? "", draft.body).catch(() => null);
      if (copy) keptAside.push(copy.title);
      else unresolved.push(draft); // neither saved nor kept aside: keep it for the next boot
    }
  }
  // store what's left BEFORE clearing what it came from: if storage refuses,
  // this throws and both entries stay for the next boot
  if (unresolved.length === 0) storage.removeItem(keptKey(key));
  else storage.setItem(keptKey(key), JSON.stringify(unresolved));
  storage.removeItem(key);
  return { saved, keptAside, unresolved: unresolved.length };
}
