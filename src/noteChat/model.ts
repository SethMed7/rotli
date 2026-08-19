import { slugify } from "../memex/contract";

export interface AttachedChatSummary {
  slug: string;
  attachedTo?: string | undefined;
  title?: string;
  modifiedMs?: number;
}

export function noteStemFromPath(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").pop() ?? "";
  return file.replace(/\.md$/i, "");
}

export function attachedNoteStem(value: string | undefined): string {
  return (value ?? "").replace(/^\[\[|\]\]$/g, "").trim();
}

/** ALL chats attached to one note, newest work first — a note owns many chats
 * (the maintainer, 2026-07-30); the default open continues where the user left off. */
export function findAttachedChats(chats: AttachedChatSummary[], noteStem: string): AttachedChatSummary[] {
  return chats
    .filter((chat) => attachedNoteStem(chat.attachedTo) === noteStem)
    .sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));
}

export function findAttachedChatSlug(chats: AttachedChatSummary[], noteStem: string): string | null {
  return findAttachedChats(chats, noteStem)[0]?.slug ?? null;
}

/** A stable, collision-resistant slug while keeping the stored chat title clean. */
export function noteChatSlug(noteTitle: string, noteId: string): string {
  const tail =
    noteId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-6)
      .toLowerCase() || "note";
  const base = slugify(`chat about ${noteTitle || "untitled"}`).slice(0, 52) || "note-chat";
  return `${base}-${tail}`;
}

/** A free slug for one MORE chat on the same note: the deterministic base for
 * the first, then base-2, base-3… — never overwrites an existing transcript. */
export function nextNoteChatSlug(noteTitle: string, noteId: string, takenSlugs: Iterable<string>): string {
  const taken = new Set(takenSlugs);
  const base = noteChatSlug(noteTitle, noteId);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const slug = `${base}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

export function secureNoteStem(noteId: string): string {
  const tail =
    noteId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-6)
      .toLowerCase() || "note";
  return `secure-note-${tail}`;
}
