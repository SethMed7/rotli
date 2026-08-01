import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { listChats, setChatAttachedTo, writeNote } from "../memex/service";
import { invalidateMemex } from "../memex/useMemex";
import { invalidateNotes } from "../services/hooks";
import { isChatsPath } from "../services/destinations";
import { notesService } from "../services/notes";
import { attachedNoteId, type MemoryTurn } from "./model";
import { syncChatMemory, type ChatMemoryNote, type ComposeChatNotes } from "./workflow";

export interface ManagedChatMemoryInput {
  instance: MemexInstance;
  title: string;
  chatSlug: string;
  attachedStem?: string;
  turns: readonly MemoryTurn[];
  /** The model that rewrites the conversation notes each turn (optional —
   * without it, existing notes are kept and new notes get the topics digest). */
  composeNotes?: ComposeChatNotes;
}

export async function syncManagedChatMemory(input: ManagedChatMemoryInput): Promise<ChatMemoryNote> {
  const prefix = input.instance.id === CORPUS_INSTANCE_ID ? "" : `${input.instance.id}:`;
  const attachedStem =
    input.attachedStem ||
    (await listChats(input.instance))
      .find((chat) => chat.slug === input.chatSlug)
      ?.attachedTo.replace(/^\[\[|\]\]$/g, "")
      .trim();
  const repository = {
    async findByStem(stem: string): Promise<ChatMemoryNote | null> {
      // Scope the lookup to THIS brain's root. The unscoped "All notes" listing
      // drops every note in a connected brain (isVault: ids are "<brain>:…"),
      // so a chat attached to a vault note resolved to nothing — and every turn
      // minted one more duplicate memory note (2026-08-01). The corpus instance
      // has no prefix and keeps the unscoped listing.
      const summaries = await notesService.listNotes(prefix || undefined);
      const id = attachedNoteId(
        stem,
        summaries.filter((note) => !isChatsPath(note.folderId)),
      );
      if (!id) return null;
      const note = await notesService.getNote(id);
      return note ? { id, stem, body: note.body } : null;
    },
    async create(body: string): Promise<ChatMemoryNote> {
      const created = await writeNote({ instance: input.instance, body });
      return { id: `${prefix}${created.id}`, stem: created.stem, body };
    },
    update: async (id: string, body: string) => void (await notesService.updateNote(id, body)),
    attach: (stem: string) => setChatAttachedTo(input.instance, input.chatSlug, stem),
  };
  const note = await syncChatMemory(repository, {
    ...input,
    ...(attachedStem ? { attachedStem } : {}),
  });
  await Promise.all([invalidateNotes(), invalidateMemex()]);
  return note;
}
