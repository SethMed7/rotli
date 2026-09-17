import { type ChatModelInfo, corpusFrontmatter, corpusWriteAi, isTauri } from "../lib/tauri";
import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { noteSlugify } from "../memex/contract";
import { listChats, setChatAttachedTo, writeNote } from "../memex/service";
import { invalidateMemex } from "../memex/useMemex";
import { titleOf } from "../services/derive";
import { isChatsPath } from "../services/destinations";
import { invalidateNotes } from "../services/hooks";
import { inboxFolderId, notesService } from "../services/notes";
import { type AttachedNoteCandidate, attachedNoteMatches, type MemoryTurn, pickChatNote } from "./model";
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
  expectedRevision?: string,
): Promise<void> {
  const frontmatter = await corpusFrontmatter(id).catch(() => null);
  if (!frontmatter) {
    throw new Error("This note's protection state couldn't be read, so the chat didn't rewrite it.");
  }
  if (frontmatter.locked) {
    throw new Error("This note is locked — no AI may edit it, so the chat left it alone.");
  }
  // no model ⇒ treat the write as REMOTE, the fail-closed direction
  if (!expectedRevision) throw new Error("This note has no save revision. Read it again before editing.");
  await corpusWriteAi(id, body, model ?? { id: "", endpoint: "" }, expectedRevision);
}

/** The chat's note among the notes answering to `stem` (model.ts owns the
 * matching and the tie-break). Only an ambiguous stem reads bodies, and only
 * the few that match, to find the one that links back to the chat. */
export async function resolveChatNoteId(
  stem: string,
  chatSlug: string,
  candidates: Iterable<AttachedNoteCandidate>,
  readBody: (id: string) => Promise<string | null> = async (id) =>
    (await notesService.getNote(id))?.body ?? null,
): Promise<string | null> {
  const matches = attachedNoteMatches(stem, candidates);
  if (matches.length <= 1) return matches[0]?.id ?? null;
  const link = `[[${chatSlug}]]`;
  const ranked = await Promise.all(
    matches.map(async (match) => ({
      id: match.id,
      ...(match.updatedAt === undefined ? {} : { updatedAt: match.updatedAt }),
      linksChat: ((await readBody(match.id)) ?? "").includes(link),
    })),
  );
  return pickChatNote(ranked);
}

export async function syncManagedChatMemory(input: ManagedChatMemoryInput): Promise<ChatMemoryNote | null> {
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
      const id = await resolveChatNoteId(
        stem,
        input.chatSlug,
        summaries.filter((note) => !isChatsPath(note.folderId)),
      );
      if (!id) return null;
      const note = await notesService.getNote(id);
      return note ? { id, stem, body: note.body, revision: note.revision } : null;
    },
    async create(body: string): Promise<ChatMemoryNote> {
      // Rotli Web: the notes service IS the vault (no memex note command), and
      // the note's slug alias is the stem the chat attaches to. It is a note,
      // not a capture, so it is born in the Inbox folder, never on the board.
      if (!isTauri()) {
        const note = await notesService.createNote(inboxFolderId, body);
        return { id: note.id, stem: noteSlugify(titleOf(body)) || "note", body, revision: note.revision };
      }
      // no shelf: a chat's note is a background note, not a capture — it
      // projects to where it lives (staging, then the area the Librarian files
      // it under), never to the Captures board (the owner, 2026-09-17)
      const created = await writeNote({ instance: input.instance, body, shelf: [] });
      const id = `${prefix}${created.id}`;
      const note = await notesService.getNote(id);
      if (!note) throw new Error("The new conversation note could not be read back after creation.");
      return { id, stem: created.stem, body, revision: note.revision };
    },
    // browser mode has no corpus, so the twin keeps the in-memory service
    update: async (id: string, body: string, expectedRevision: string) => {
      if (!isTauri()) {
        await notesService.updateNote(id, body, expectedRevision);
        return;
      }
      await updateNoteAsAi(id, body, input.model, expectedRevision);
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
