// What each chat command does, through the app's existing actions: a board
// through the board store, a note through the normal note-create lane, a new
// chat and a new board through their registered actions. No command sends
// anything to a model; the secure mark decides what a command may write.

import { boardsAvailable, createEditableBoardFromMermaid } from "../../boards/composition";
import { dispatch } from "../../keys/registry";
import type { MemexInstance } from "../../memex/config";
import { noteAttachment } from "../../noteChat/composition";
import { createChatNote } from "../../services/createNote";
import { invalidateNotes } from "../../services/hooks";
import type { NoteSummary } from "../../types";
import {
  type ChatCommandId,
  latestReplyMermaid,
  latestReplyText,
  type PendingAttachment,
  replyNoteBody,
} from "./chatComposerMenuModel";

/** The tag API (validate/add/remove/list, owned by Rust) is not in this build,
 * so /tag stays hidden rather than writing tags down a second path. */
const TAG_API = false;

/** The pulled-out chat window hosts chats only: no board tab, no naming dialog. */
const IN_CHAT_WINDOW =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === "chat";

export interface ChatCommandContext {
  instance: MemexInstance | null;
  writable: boolean;
  chatTitle: string;
  messages: readonly { speaker: string; text: string }[];
  /** The chat carries secure-note content (attached, pending or read). */
  secure: boolean;
  /** The chat already has a saved note; @ never swaps it for another. */
  hasNote: boolean;
  canPickModel: boolean;
  rootId: string | null;
  openModelPicker: () => void;
  openNote: (noteId: string) => void;
  notify: (text: string) => void;
}

export function availableChatCommands(
  ctx: Pick<ChatCommandContext, "instance" | "writable" | "messages" | "hasNote" | "canPickModel">,
): Set<ChatCommandId> {
  const ids = new Set<ChatCommandId>(["new"]);
  if (boardsAvailable() && !IN_CHAT_WINDOW) ids.add("board");
  if (ctx.instance && ctx.writable && latestReplyText(ctx.messages)) ids.add("note");
  if (!ctx.hasNote) ids.add("attach");
  if (ctx.canPickModel) ids.add("model");
  if (TAG_API) ids.add("tag");
  return ids;
}

const SECURE_BOARD =
  "This chat carries secure-note content, and boards are not protected files. Put the diagram in a secure note instead.";

async function run(id: ChatCommandId, ctx: ChatCommandContext): Promise<void> {
  switch (id) {
    case "board": {
      const mermaid = latestReplyMermaid(ctx.messages);
      if (!mermaid) return dispatch("boards.new");
      if (ctx.secure) return ctx.notify(SECURE_BOARD);
      await createEditableBoardFromMermaid(mermaid, {
        name: ctx.chatTitle || "Diagram",
        ...(ctx.rootId ? { rootId: ctx.rootId } : {}),
      });
      return;
    }
    case "note": {
      const reply = latestReplyText(ctx.messages);
      if (!ctx.instance || !reply) return ctx.notify("There is no reply to save yet.");
      const body = replyNoteBody(ctx.chatTitle, reply);
      const { id: noteId } = await createChatNote(
        ctx.instance,
        body,
        undefined,
        ctx.secure ? { secure: true } : undefined,
      );
      await invalidateNotes();
      ctx.openNote(noteId);
      return;
    }
    case "model":
      return ctx.openModelPicker();
    case "new":
      return dispatch("chat.new");
    case "attach":
    case "tag":
      return;
  }
}

export async function runChatCommand(id: ChatCommandId, ctx: ChatCommandContext): Promise<void> {
  try {
    await run(id, ctx);
  } catch (error) {
    ctx.notify(error instanceof Error ? error.message : String(error));
  }
}

/** Resolve a picked note the way "Chat with this note" does: its attachment
 * stem and its secure verdict (frontmatter, secure folder or secure lane). */
export async function pendingNoteFor(
  note: NoteSummary,
  chatVaultId: string | null,
  notify: (text: string) => void,
): Promise<PendingAttachment | null> {
  try {
    const { instance, stem, secure } = await noteAttachment(note);
    // a chat pinned to another vault would record a stem that resolves elsewhere
    if (chatVaultId && instance.id !== chatVaultId) {
      notify("This chat belongs to another vault. Open that vault to talk about its notes.");
      return null;
    }
    return { noteId: note.id, title: note.title, stem, secure };
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return null;
  }
}
