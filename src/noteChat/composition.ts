/** Open (or create) the durable chat attached to one Markdown note. */
import { corpusFrontmatter, corpusNotePath } from "../lib/tauri";
import { activeInstance } from "../memex/config";
import { invalidateMemex } from "../memex/useMemex";
import {
  listChats,
  loadConfig,
  setChatAttachedTo,
  writeChat,
} from "../memex/service";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { noteDiskFolder } from "../lib/noteLocation";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import {
  findAttachedChatSlug,
  noteChatSlug,
  noteStemFromPath,
  secureNoteStem,
} from "./model";
import { rememberChatNote } from "./session";

export async function openChatForNote(note: NoteSummary): Promise<void> {
  if (note.kind === "board" || note.kind === "file") {
    throw new Error("Chat with note is available for Markdown notes.");
  }
  const instance = activeInstance(await loadConfig());
  if (!instance || instance.perms !== "chats+inbox") {
    throw new Error("Connect a writable brain before starting a note chat.");
  }

  const notePath = await corpusNotePath(note.id);
  const folder = noteDiskFolder(note);
  const secure =
    (await corpusFrontmatter(note.id).catch(() => null))?.secure === true ||
    isSecureBrainFolder(folder) ||
    isSecureNotesFolder(folder) ||
    /(?:^|\/)wiki\/_secure(?:\/|$)/.test(notePath.replace(/^[^:]+:/, ""));
  const stem = secure
    ? secureNoteStem(note.id)
    : noteStemFromPath(notePath);
  if (!stem) throw new Error("Rotli couldn’t resolve this note in the brain.");

  const chats = await listChats(instance);
  let slug = findAttachedChatSlug(chats, stem);
  if (!slug) {
    const chatSubject = secure ? "secure note" : note.title;
    slug = noteChatSlug(chatSubject, note.id);
    const sameSlug = chats.some((chat) => chat.slug === slug);
    if (sameSlug) {
      // Preserve an existing transcript. This also repairs an older chat whose
      // attachment metadata was missing rather than overwriting its bytes.
      await setChatAttachedTo(instance, slug, stem);
    } else {
      await writeChat({
        instance,
        slug,
        title: secure ? "Chat about a secure note" : `Chat about ${note.title || "Untitled"}`,
        attachedTo: stem,
        messages: [],
      });
    }
    await invalidateMemex();
  }

  const ui = useUiStore.getState();
  ui.setSettingsOpen(false);
  ui.setSidebarMode("notes");
  rememberChatNote(slug, note.id);
  usePanesStore.getState().openChat(slug, { newTab: true });
}
