import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { type ChatModelInfo, corpusFrontmatter, corpusWriteAi, isTauri } from "../lib/tauri";
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
  /** The chat's model. The per-turn note rewrite is an AI WRITE, so it rides
   * `corpus_write_ai` — Rust re-derives locality, re-runs the read gate, and
   * refuses a locked note (docs/design/ai-visibility-matrix.md). Absent ⇒ the
   * write is treated as remote, which is the fail-closed direction. */
  model?: Pick<ChatModelInfo, "id" | "endpoint">;
}

/** Rewrite a note on behalf of the chat's model — the per-turn conversation-note
 * sync. This is an AI WRITE, so it takes the AI write lane, not the human
 * editor's: LOCKED is refused here (fail-fast; an unreadable protection state
 * counts as refused) AND again inside `corpus_write_ai`, because neither layer
 * trusts the other (docs/design/ai-visibility-matrix.md). */
export async function updateNoteAsAi(
  id: string,
  body: string,
  model?: Pick<ChatModelInfo, "id" | "endpoint">,
): Promise<void> {
  const frontmatter = await corpusFrontmatter(id).catch(() => null);
  if (!frontmatter) {
    throw new Error("This note's protection state couldn't be read, so the chat didn't rewrite it.");
  }
  if (frontmatter.locked) {
    throw new Error("This note is locked — no AI may edit it, so the chat left it alone.");
  }
  // no model ⇒ treat the write as REMOTE, the fail-closed direction
  await corpusWriteAi(id, body, model ?? { id: "", endpoint: "" });
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
    // browser mode has no corpus, so the twin keeps the in-memory service
    update: async (id: string, body: string) => {
      if (!isTauri()) {
        await notesService.updateNote(id, body);
        return;
      }
      await updateNoteAsAi(id, body, input.model);
    },
    attach: (stem: string) => setChatAttachedTo(input.instance, input.chatSlug, stem),
  };
  const note = await syncChatMemory(repository, {
    ...input,
    ...(attachedStem ? { attachedStem } : {}),
  });
  await Promise.all([invalidateNotes(), invalidateMemex()]);
  return note;
}
