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
  /** May the chat's model rewrite this note (src/lib/aiEditPolicy.ts)? */
  aiEditable: boolean;
}

export interface ChatMemoryRepository {
  findByStem(stem: string): Promise<ChatMemoryNote | null>;
  create(body: string): Promise<ChatMemoryNote>;
  update(id: string, body: string, expectedRevision: string): Promise<void>;
  attach(stem: string): Promise<void>;
  /** The chat's own notes note, kept apart from a person's attached note. */
  findMemoryNote(): Promise<ChatMemoryNote | null>;
  setMemoryNote(stem: string): Promise<void>;
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
): Promise<ChatMemoryNote | null> {
  let note = input.attachedStem ? await repository.findByStem(input.attachedStem) : null;
  // A chat that points at a note this listing cannot reach (deleted, or a
  // cold vault) gets NO new note: minting one beside the pointer made a fresh
  // duplicate every turn and never attached it (2026-09-17). The pointer
  // stays; the chat's note button self-heals when the user asks for the note.
  if (!note && input.attachedStem) return null;
  // A note the chat may not rewrite (a person wrote it, or AI editing is off)
  // is READ for its notes but never written: the chat keeps its own
  // chat-made note beside it (2026-09-29). `attachedTo` stays on the person's
  // note, so the note still lists this chat.
  let separate = false;
  let seedNotes: string | null = null;
  if (note && !note.aiEditable) {
    seedNotes = extractChatNotes(note.body);
    const own = await repository.findMemoryNote();
    if (own && !own.aiEditable) return null; // the person turned it off there too
    note = own;
    separate = !own;
  }
  const currentNotes = note ? extractChatNotes(note.body) : seedNotes;

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
    if (separate) {
      await repository.setMemoryNote(note.stem);
      return note;
    }
    // Otherwise only an unattached chat reaches here, and it adopts its memory note.
    // `attachedTo` is the note→chats link the editor's chat chip lists from;
    // re-pointing an attached chat at a fresh note orphaned it from the note
    // it was opened on (2026-08-01), which is why the attached-but-missing
    // case above returns before creating anything.
    await repository.attach(note.stem);
    return note;
  }
  const next = mergeChatMemory(note.body, input.title, input.chatSlug, content);
  if (next !== note.body) {
    await repository.update(note.id, next, note.revision);
    note = { ...note, body: next };
  }
  return note;
}
