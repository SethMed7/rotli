import { slugify } from "../memex/contract";

export interface AttachedChatSummary {
  slug: string;
  attachedTo?: string | undefined;
}

export function noteStemFromPath(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").pop() ?? "";
  return file.replace(/\.md$/i, "");
}

export function attachedNoteStem(value: string | undefined): string {
  return (value ?? "").replace(/^\[\[|\]\]$/g, "").trim();
}

export function findAttachedChatSlug(
  chats: AttachedChatSummary[],
  noteStem: string,
): string | null {
  return chats.find((chat) => attachedNoteStem(chat.attachedTo) === noteStem)?.slug ?? null;
}

/** A stable, collision-resistant slug while keeping the stored chat title clean. */
export function noteChatSlug(noteTitle: string, noteId: string): string {
  const tail = noteId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase() || "note";
  const base = slugify(`chat about ${noteTitle || "untitled"}`).slice(0, 52) || "note-chat";
  return `${base}-${tail}`;
}

export function secureNoteStem(noteId: string): string {
  const tail = noteId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase() || "note";
  return `secure-note-${tail}`;
}
