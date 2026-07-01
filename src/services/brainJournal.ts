// The brain change JOURNAL — the audit + undo log for AI Filer actions (design §4.4).
// Frontend-owned `.rotli/brain-journal.jsonl`, one JSON action per line. In Phase 3
// the actions are USER-triggered ("file this note"); Phase 4's daemon appends the same
// shape. Undo works off `before`/`after` (no git dependency) — see and reverse every
// AI write before anything becomes automatic.

import {
  corpusFilerMove,
  corpusJournalAppend,
  corpusJournalRead,
  corpusSetAiField,
} from "../lib/tauri";

export interface BrainAction {
  id: string;
  ts: number;
  action: "file" | "field";
  /** The note's CURRENT rel path (after the action) — what undo operates on. */
  noteId: string;
  noteTitle: string;
  area?: string;
  /** file: the old folder · field: the old value ("" if it was unset). */
  before: string;
  /** file: the new folder · field: the new value. */
  after: string;
  /** for action "field" — the key that changed. */
  field?: string;
  status: "applied" | "reverted";
}

export async function readJournal(): Promise<BrainAction[]> {
  const raw = await corpusJournalRead();
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as BrainAction];
      } catch {
        return [];
      }
    });
}

let counter = 0;
function actionId(ts: number): string {
  return `${ts.toString(36)}-${(counter++).toString(36)}`;
}

/** Record an applied Filer action. */
export async function logAction(a: Omit<BrainAction, "id" | "ts" | "status">): Promise<BrainAction> {
  const ts = Date.now();
  const entry: BrainAction = { ...a, id: actionId(ts), ts, status: "applied" };
  await corpusJournalAppend(JSON.stringify(entry));
  return entry;
}

/** Reverse an applied action and append a `reverted` marker. A file moves back to its
 * `before` folder; a field restores its `before` value. */
export async function undoAction(a: BrainAction): Promise<void> {
  if (a.action === "file") {
    await corpusFilerMove(a.noteId, a.before);
  } else if (a.action === "field" && a.field) {
    await corpusSetAiField(a.noteId, a.field, a.before);
  }
  await corpusJournalAppend(JSON.stringify({ ...a, status: "reverted", ts: Date.now() }));
}
