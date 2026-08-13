import {
  extractChatNotes,
  fallbackChatNotes,
  mergeChatMemory,
  sanitizeChatNotes,
  type MemoryTurn,
} from "./model";

export interface ChatMemoryNote {
  id: string;
  stem: string;
  body: string;
  revision: string;
}

export interface ChatMemoryRepository {
  findByStem(stem: string): Promise<ChatMemoryNote | null>;
  create(body: string): Promise<ChatMemoryNote>;
  update(id: string, body: string, expectedRevision: string): Promise<void>;
  attach(stem: string): Promise<void>;
}

/** Writes the notes section's content — usually a model rewriting the whole
 * notes from the conversation so far. Null (or a throw) falls back safely. */
export type ComposeChatNotes = (context: {
  turns: readonly MemoryTurn[];
  currentNotes: string | null;
}) => Promise<string | null>;

export interface SyncChatMemoryInput {
  title: string;
  chatSlug: string;
  attachedStem?: string;
  turns: readonly MemoryTurn[];
  composeNotes?: ComposeChatNotes;
}

/** Ensure every persisted chat has one note carrying real conversation NOTES
 * (not a transcript). The section content comes from `composeNotes` when a
 * model is available; otherwise existing notes are kept, and a brand-new note
 * gets the deterministic topics digest. Only the managed section is touched. */
export async function syncChatMemory(
  repository: ChatMemoryRepository,
  input: SyncChatMemoryInput,
): Promise<ChatMemoryNote> {
  let note = input.attachedStem ? await repository.findByStem(input.attachedStem) : null;
  const currentNotes = note ? extractChatNotes(note.body) : null;

  let notes: string | null = null;
  if (input.composeNotes) {
    try {
      notes = sanitizeChatNotes(await input.composeNotes({ turns: input.turns, currentNotes }));
    } catch {
      notes = null; // a failed model call never blocks the turn's persistence
    }
  }
  const content = notes ?? currentNotes ?? fallbackChatNotes(input.turns);

  if (!note) {
    const body = mergeChatMemory("", input.title, input.chatSlug, content);
    note = await repository.create(body);
    // A chat that already points at a note KEEPS pointing at it. `attachedTo`
    // is the note→chats link the editor's chat chip lists from; re-pointing it
    // at a freshly written memory note orphaned every chat from the note it was
    // opened on, so the chip listed nothing, fell through to "continue the
    // deterministic chat", and Seth got the same chat with no picker forever
    // (2026-08-01). Only an unattached chat adopts its memory note.
    if (!input.attachedStem) await repository.attach(note.stem);
    return note;
  }
  const next = mergeChatMemory(note.body, input.title, input.chatSlug, content);
  if (next !== note.body) {
    await repository.update(note.id, next, note.revision);
    note = { ...note, body: next };
  }
  return note;
}
