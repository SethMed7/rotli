// The chat composer's command menu and note mentions, as pure text rules.
// "/" opens the command menu and "@" opens the note picker, each only at the
// start of the message or after whitespace, so `and/or`, a URL and an email
// address stay literal. The menu never writes Markdown into a note: a command
// runs an app action and leaves the composer with the rest of the draft.

import { isConsultAlias } from "../../ai/chatProvider";
import { isChatsPath } from "../../services/destinations";
import type { NoteSummary } from "../../types";

export type ChatCommandId = "attach" | "board" | "model" | "new" | "note" | "tag";

export interface ChatCommand {
  id: ChatCommandId;
  label: string;
  hint: string;
  keywords: readonly string[];
}

/** Catalog order is the menu's order when nothing is typed. */
export const CHAT_COMMANDS: readonly ChatCommand[] = [
  {
    id: "board",
    label: "board",
    hint: "Make a board from the latest diagram, or a new one",
    keywords: ["canvas", "diagram", "excalidraw", "mermaid", "draw"],
  },
  {
    id: "note",
    label: "note",
    hint: "Save the latest reply as a new note",
    keywords: ["save", "reply", "keep"],
  },
  {
    id: "attach",
    label: "attach",
    hint: "Pick a note this chat talks about",
    keywords: ["context", "mention", "link", "note"],
  },
  {
    id: "model",
    label: "model",
    hint: "Switch the model for this chat",
    keywords: ["switch", "provider", "llm"],
  },
  {
    id: "new",
    label: "new",
    hint: "Start a new chat",
    keywords: ["fresh", "chat", "start"],
  },
  {
    id: "tag",
    label: "tag",
    hint: "Tag this chat's note",
    keywords: ["label"],
  },
];

export type ComposerTriggerKind = "command" | "mention";

/** The `/query` or `@query` token the caret sits in: `from` is the sigil,
 * `to` the token's end (the caret, or further when the caret is mid-word). */
export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  from: number;
  to: number;
  query: string;
}

const COMMAND_BEFORE = /(^|\s)\/([a-z0-9-]*)$/i;
const MENTION_BEFORE = /(^|\s)@([^\s@/]*)$/;
const COMMAND_AFTER = /^[a-z0-9-]*/i;
const MENTION_AFTER = /^[^\s@/]*/;

/** Which menu the text before the caret asks for, if any. */
export function composerTrigger(text: string, caret: number): ComposerTrigger | null {
  const before = text.slice(0, caret);
  const command = COMMAND_BEFORE.exec(before);
  if (command) {
    const from = caret - command[2]!.length - 1;
    const tail = COMMAND_AFTER.exec(text.slice(caret))?.[0] ?? "";
    return { kind: "command", from, to: caret + tail.length, query: command[2]! + tail };
  }
  const mention = MENTION_BEFORE.exec(before);
  if (mention) {
    const tail = MENTION_AFTER.exec(text.slice(caret))?.[0] ?? "";
    const query = mention[2]! + tail;
    // `@claude` and the other provider tags keep their own meaning
    if (isConsultAlias(query.split(":")[0] ?? "")) return null;
    const from = caret - mention[2]!.length - 1;
    return { kind: "mention", from, to: caret + tail.length, query };
  }
  return null;
}

/** The draft without the trigger token, and where the caret goes. One space
 * between the words on each side survives; edges are trimmed. */
export function removeTrigger(text: string, trigger: ComposerTrigger): { text: string; caret: number } {
  const head = text.slice(0, trigger.from);
  const tail = text.slice(trigger.to);
  const joined = /\s$/.test(head) || head === "" ? head + tail.replace(/^[ \t]+/, "") : head + tail;
  return { text: joined, caret: Math.min(head.length, joined.length) };
}

/** Replace the trigger token with `replacement` (Tab completion, /attach → @). */
export function replaceTrigger(
  text: string,
  trigger: ComposerTrigger,
  replacement: string,
): { text: string; caret: number } {
  const next = text.slice(0, trigger.from) + replacement + text.slice(trigger.to);
  return { text: next, caret: trigger.from + replacement.length };
}

const NO_MATCH = 4;

/** 0 the name starts with the query, 1 the description has a word that does,
 * 2 the name holds it, 3 only a keyword does. */
function commandRank(command: ChatCommand, q: string): number {
  if (command.label.startsWith(q)) return 0;
  if (
    command.hint
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(q))
  )
    return 1;
  if (command.label.includes(q)) return 2;
  return command.keywords.some((keyword) => keyword.startsWith(q)) ? 3 : NO_MATCH;
}

/** The commands this chat can run, best match first, catalog order within a rank. */
export function filterChatCommands(query: string, available: ReadonlySet<ChatCommandId>): ChatCommand[] {
  const q = query.trim().toLowerCase();
  const offered = CHAT_COMMANDS.filter((command) => available.has(command.id));
  if (!q) return offered;
  return offered
    .map((command) => ({ command, rank: commandRank(command, q) }))
    .filter(({ rank }) => rank < NO_MATCH)
    .sort((a, b) => a.rank - b.rank)
    .map(({ command }) => command);
}

/** How many notes the mention picker shows at once. */
export const MENTION_LIMIT = 8;

/** Markdown notes a chat can be about: no boards, files or chat transcripts. */
export function mentionableNotes(notes: Iterable<NoteSummary>): NoteSummary[] {
  return [...notes].filter(
    (note) => (note.kind ?? "note") === "note" && !isChatsPath(note.diskFolderId ?? note.folderId),
  );
}

/** Notes matching the `@query`: title prefix, then a title word, then anywhere
 * in the title; most recently edited first within a rank. */
export function filterMentionNotes(query: string, notes: readonly NoteSummary[]): NoteSummary[] {
  const q = query.trim().toLowerCase();
  const rank = (note: NoteSummary) => {
    const title = (note.title || "Untitled").toLowerCase();
    if (!q || title.startsWith(q)) return 0;
    if (title.split(/\s+/).some((word) => word.startsWith(q))) return 1;
    return title.includes(q) ? 2 : NO_MATCH;
  };
  return notes
    .map((note) => ({ note, rank: rank(note) }))
    .filter(({ rank: r }) => r < NO_MATCH)
    .sort((a, b) => a.rank - b.rank || b.note.updatedAt - a.note.updatedAt)
    .slice(0, MENTION_LIMIT)
    .map(({ note }) => note);
}

const MERMAID_FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/g;

/** The newest Mermaid diagram any reply holds, or null. */
export function latestReplyMermaid(messages: readonly { speaker: string; text: string }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.speaker === "you") continue;
    const fences = [...message.text.matchAll(MERMAID_FENCE)];
    const code = fences.at(-1)?.[1]?.trim();
    if (code) return code;
  }
  return null;
}

/** The newest reply's Markdown, or null when nothing has answered yet. */
export function latestReplyText(messages: readonly { speaker: string; text: string }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.speaker !== "you" && message.text.trim() && !message.text.startsWith("⚠")) {
      return message.text.trim();
    }
  }
  return null;
}

/** A saved reply's note body: the reply under the chat's title, unless the
 * reply already opens with its own heading. */
export function replyNoteBody(chatTitle: string, reply: string): string {
  if (/^#\s/.test(reply)) return `${reply}\n`;
  return `# ${chatTitle.trim() || "Saved reply"}\n\n${reply}\n`;
}

/** A note picked with @ before the chat sends: what the chip shows and what
 * the send attaches. `stem` is the attachment name (a secure note's is its
 * `secure-note-<id6>` stand-in, so its title never reaches chats/). */
export interface PendingAttachment {
  noteId: string;
  title: string;
  stem: string;
  secure: boolean;
}

/** The chat's attachment and security as the composer sees it: a pending @note
 * counts exactly like a saved attachment, so a secure one strips remote
 * models from the picker and the send refuses them before anything leaves. */
export function composerAttachment(input: {
  savedStem: string;
  savedNoteId: string | null;
  pending: PendingAttachment | null;
  secureContext: boolean;
}): { noteId: string | null; secureHint: boolean; secureChat: boolean } {
  const secureHint = input.savedStem.startsWith("secure-note-") || input.pending?.secure === true;
  return {
    noteId: input.pending?.noteId ?? input.savedNoteId,
    secureHint,
    secureChat: secureHint || input.secureContext,
  };
}
