import { noteDiskFolder } from "../lib/noteLocation";
/** Open, create, or list the durable chats attached to one Markdown note. A
 * note owns MANY chats (the maintainer, 2026-07-30): the default open continues the most
 * recently touched one; `create` starts another; the editor's chat chip lists
 * them all. */
import { corpusFrontmatter, corpusNotePath } from "../lib/tauri";
import { activeInstance } from "../memex/config";
import type { MemexInstance } from "../memex/config";
import { listChats, loadConfig, setChatAttachedTo, writeChat } from "../memex/service";
import { invalidateMemex } from "../memex/useMemex";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import { notesService } from "../services/notes";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import {
  type AttachedChatSummary,
  findAttachedChats,
  nextNoteChatSlug,
  noteChatSlug,
  noteStemFromPath,
  secureNoteStem,
} from "./model";
import { rememberChatNote } from "./session";

interface NoteChatContext {
  instance: MemexInstance;
  stem: string;
  secure: boolean;
  chats: AttachedChatSummary[];
  attached: AttachedChatSummary[];
}

/** Resolve the note's chat identity: the writable brain, the attachment stem
 * (secure notes collapse to secure-note-<id6> so their name never leaks into
 * chats/), and every chat already attached to it. */
async function noteChatContext(note: NoteSummary): Promise<NoteChatContext> {
  if (note.kind === "board" || note.kind === "file") {
    throw new Error("Chat with note is available for Markdown notes.");
  }
  const instance = activeInstance(await loadConfig());
  if (!instance || instance.perms !== "chats+inbox") {
    throw new Error("Choose a writable vault before starting a note chat.");
  }

  const notePath = await corpusNotePath(note.id);
  const folder = noteDiskFolder(note);
  const secure =
    (await corpusFrontmatter(note.id).catch(() => null))?.secure === true ||
    isSecureBrainFolder(folder) ||
    isSecureNotesFolder(folder) ||
    /(?:^|\/)wiki\/_secure(?:\/|$)/.test(notePath.replace(/^[^:]+:/, ""));
  const stem = secure ? secureNoteStem(note.id) : noteStemFromPath(notePath);
  if (!stem) throw new Error("Rotli couldn’t resolve this note in the vault.");

  const chats = await listChats(instance);
  return { instance, stem, secure, chats, attached: findAttachedChats(chats, stem) };
}

/** The note's attached chats, newest work first — the chat chip's picker. */
export async function listChatsForNote(note: NoteSummary): Promise<AttachedChatSummary[]> {
  return (await noteChatContext(note)).attached;
}

function showChat(slug: string, noteId: string, vaultId?: string): void {
  const ui = useUiStore.getState();
  ui.setSettingsOpen(false);
  ui.setSidebarMode("notes");
  rememberChatNote(slug, noteId);
  usePanesStore.getState().openChat(slug, { newTab: true, ...(vaultId ? { vaultId } : {}) });
}

/** Open a SPECIFIC chat of this note (a picker row). */
export function openNoteChat(note: NoteSummary, slug: string): void {
  showChat(slug, note.id);
}

/** Open a note's chat by id — for callers that hold only the id (a chord, or
 * the Quick Note's request to main). A note that is gone opens nothing. */
export async function openChatForNoteId(id: string, opts?: { create?: boolean }): Promise<void> {
  const note = (await notesService.listNotes()).find((n) => n.id === id);
  if (note) await openChatForNote(note, opts);
}

export async function openChatForNote(note: NoteSummary, opts?: { create?: boolean }): Promise<void> {
  const { instance, stem, secure, chats, attached } = await noteChatContext(note);

  let slug = opts?.create ? null : (attached[0]?.slug ?? null);
  if (!slug) {
    const chatSubject = secure ? "secure note" : note.title;
    const base = noteChatSlug(chatSubject, note.id);
    if (!opts?.create && chats.some((chat) => chat.slug === base)) {
      // The deterministic chat file exists but lost its attachment metadata —
      // repair it in place rather than overwriting (or duplicating) its bytes.
      await setChatAttachedTo(instance, base, stem);
      slug = base;
    } else {
      slug = nextNoteChatSlug(
        chatSubject,
        note.id,
        chats.map((chat) => chat.slug),
      );
      // the 2nd+ chat carries its slug's ordinal so sidebar titles stay apart.
      // Compare against base rather than regexing the tail — a note id whose
      // last 6 chars are all digits would read as an ordinal (Greptile, PR #21)
      const ordinal = slug !== base ? slug.slice(base.length + 1) : null;
      const baseTitle = secure ? "Chat about a secure note" : `Chat about ${note.title || "Untitled"}`;
      await writeChat({
        instance,
        slug,
        title: ordinal ? `${baseTitle} · ${ordinal}` : baseTitle,
        attachedTo: stem,
        messages: [],
      });
    }
    await invalidateMemex();
  }

  showChat(slug, note.id, instance.id);
}
