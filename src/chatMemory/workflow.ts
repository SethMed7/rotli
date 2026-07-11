import { mergeChatMemory, type MemoryTurn } from "./model";

export interface ChatMemoryNote {
  id: string;
  stem: string;
  body: string;
}

export interface ChatMemoryRepository {
  findByStem(stem: string): Promise<ChatMemoryNote | null>;
  create(body: string): Promise<ChatMemoryNote>;
  update(id: string, body: string): Promise<void>;
  attach(stem: string): Promise<void>;
}

export interface SyncChatMemoryInput {
  title: string;
  chatSlug: string;
  attachedStem?: string;
  turns: readonly MemoryTurn[];
}

/** Ensure every persisted chat has one note, then deterministically refresh
 * only its managed memory block. No model call or database is required. */
export async function syncChatMemory(
  repository: ChatMemoryRepository,
  input: SyncChatMemoryInput,
): Promise<ChatMemoryNote> {
  let note = input.attachedStem ? await repository.findByStem(input.attachedStem) : null;
  if (!note) {
    const body = mergeChatMemory("", input.title, input.chatSlug, input.turns);
    note = await repository.create(body);
    await repository.attach(note.stem);
    return note;
  }
  const next = mergeChatMemory(note.body, input.title, input.chatSlug, input.turns);
  if (next !== note.body) {
    await repository.update(note.id, next);
    note = { ...note, body: next };
  }
  return note;
}
