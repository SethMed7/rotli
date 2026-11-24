// Chat projects — VIRTUAL grouping for the sidebar's Chat front. The people
// who use it call them Projects (2026-11-24); on disk they are still the
// "folders" of `.rotli/chat-folders.json`, so every folder an older build made
// is already a project with the same chats, and nothing moves. Chats stay flat
// in chats/; the manifest is a per-vault projection in the spirit of Main:
// organization is a view, never a second store. Pure manifest logic lives here
// (unit-tested); the two thin I/O helpers ride lib/tauri's memex bridge.
//
// A project's instructions are NOT kept here: they are the person's prose, so
// they live in an ordinary Markdown note (searchable, portable, able to carry
// `secure:` and `locked:`), and the project only names that note's id in
// `instructionsNote` (services/chatProjects.ts).
//
// Unknown keys — top level and per project — survive a parse/serialize round
// trip, so a newer build's fields outlive this one. Builds up to 1.9.6 do NOT
// keep them: their parser rebuilds an unpinned project as {id, name}, so a
// write from one of them drops the `instructionsNote` LINK — the note itself
// stays in the vault (chatFolders.test.ts pins that).

import { memexChatFolders, memexListChats, memexWriteChatFolders } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import { queryClient } from "./query";

export interface ChatFolder {
  id: string;
  name: string;
  /** A pinned folder floats above the others (the maintainer, 2026-08-03). Additive
   * field: absent reads as unpinned. */
  pinned?: boolean;
  /** The corpus id of the note holding the project's instructions. Additive
   * like `pinned`: absent reads as none. */
  instructionsNote?: string;
}

export interface ChatFoldersManifest {
  version: 1;
  folders: ChatFolder[];
  /** chat slug → folder id. Slugs that no longer exist are ignored on render
   * and pruned on the next write that has a complete chat listing
   * (updateChatProjects). */
  assignments: Record<string, string>;
  /** LEGACY (retired 2026-08-03): the old per-folder manual drag order.
   * Response recency now rules inside folders too, so this no longer affects
   * rendering — it stays parsed + serialized so older builds reopening the
   * manifest lose nothing. */
  order: Record<string, string[]>;
}

export const EMPTY_CHAT_FOLDERS: ChatFoldersManifest = {
  version: 1,
  folders: [],
  assignments: {},
  order: {},
};

type Loose = Record<string, unknown>;

/** A project as read: unknown keys ride along; `pinned` and
 * `instructionsNote` keep only the shapes this build understands. */
function normalizeFolder(raw: Loose): ChatFolder {
  const { pinned, instructionsNote, ...rest } = raw;
  return {
    ...rest,
    id: raw.id as string,
    name: raw.name as string,
    ...(pinned === true ? { pinned: true } : {}),
    ...(typeof instructionsNote === "string" && instructionsNote.trim() ? { instructionsNote } : {}),
  };
}

/** Parse a manifest defensively — any malformed shape reads as empty (the
 * sidecar is rebuildable; garbage must never break the chat list). */
export function parseChatFolders(raw: string): ChatFoldersManifest {
  if (!raw.trim()) return structuredClone(EMPTY_CHAT_FOLDERS);
  try {
    const parsed = JSON.parse(raw) as Partial<ChatFoldersManifest> & Loose;
    if (parsed?.version !== 1 || !Array.isArray(parsed.folders)) return structuredClone(EMPTY_CHAT_FOLDERS);
    const { folders: rawFolders, assignments: rawAssignments, order: rawOrder, ...rest } = parsed;
    const folders = (rawFolders as unknown[])
      .filter(
        (folder): folder is Loose =>
          !!folder &&
          typeof folder === "object" &&
          typeof (folder as Loose).id === "string" &&
          typeof (folder as Loose).name === "string",
      )
      .map(normalizeFolder);
    const ids = new Set(folders.map((folder) => folder.id));
    const assignments: Record<string, string> = {};
    for (const [slug, folderId] of Object.entries(rawAssignments ?? {})) {
      if (typeof folderId === "string" && ids.has(folderId)) assignments[slug] = folderId;
    }
    const order: Record<string, string[]> = {};
    for (const [folderId, slugs] of Object.entries(rawOrder ?? {})) {
      if (!ids.has(folderId) || !Array.isArray(slugs)) continue;
      order[folderId] = slugs.filter((slug): slug is string => typeof slug === "string");
    }
    return { ...rest, version: 1, folders, assignments, order };
  } catch {
    return structuredClone(EMPTY_CHAT_FOLDERS);
  }
}

export function serializeChatFolders(manifest: ChatFoldersManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function folderId(): string {
  return `cf-${crypto.randomUUID().slice(0, 8)}`;
}

export function createChatFolder(
  manifest: ChatFoldersManifest,
  name: string,
): { manifest: ChatFoldersManifest; id: string } {
  const id = folderId();
  const trimmed = name.trim() || "New project";
  return {
    manifest: {
      ...manifest,
      folders: [...manifest.folders, { id, name: trimmed }],
    },
    id,
  };
}

export function renameChatFolder(
  manifest: ChatFoldersManifest,
  id: string,
  name: string,
): ChatFoldersManifest {
  const trimmed = name.trim();
  if (!trimmed) return manifest;
  return {
    ...manifest,
    folders: manifest.folders.map((folder) => (folder.id === id ? { ...folder, name: trimmed } : folder)),
  };
}

/** Pin/unpin a folder — pinned folders float above the rest (2026-08-03). */
export function setChatFolderPinned(
  manifest: ChatFoldersManifest,
  id: string,
  pinned: boolean,
): ChatFoldersManifest {
  if (!manifest.folders.some((folder) => folder.id === id)) return manifest;
  return {
    ...manifest,
    folders: manifest.folders.map((folder) =>
      folder.id !== id ? folder : pinned ? { ...folder, pinned: true } : withoutKey(folder, "pinned"),
    ),
  };
}

function withoutKey(folder: ChatFolder, key: "pinned" | "instructionsNote"): ChatFolder {
  const copy = { ...folder };
  delete copy[key];
  return copy;
}

/** Link a project to the note holding its instructions; null unlinks (the
 * note itself is never touched). */
export function setChatFolderInstructionsNote(
  manifest: ChatFoldersManifest,
  id: string,
  noteId: string | null,
): ChatFoldersManifest {
  if (!manifest.folders.some((folder) => folder.id === id)) return manifest;
  return {
    ...manifest,
    folders: manifest.folders.map((folder) =>
      folder.id !== id
        ? folder
        : noteId
          ? { ...folder, instructionsNote: noteId }
          : withoutKey(folder, "instructionsNote"),
    ),
  };
}

/** Deleting a folder frees its chats back to the loose list — never touches files. */
export function deleteChatFolder(manifest: ChatFoldersManifest, id: string): ChatFoldersManifest {
  return {
    ...manifest,
    folders: manifest.folders.filter((folder) => folder.id !== id),
    assignments: Object.fromEntries(
      Object.entries(manifest.assignments).filter(([, assigned]) => assigned !== id),
    ),
    order: Object.fromEntries(Object.entries(manifest.order).filter(([folderId]) => folderId !== id)),
  };
}

/** Assign a chat to a folder (null clears it back to the loose list). */
export function assignChatToFolder(
  manifest: ChatFoldersManifest,
  slug: string,
  id: string | null,
): ChatFoldersManifest {
  const assignments = { ...manifest.assignments };
  if (id === null) delete assignments[slug];
  else if (manifest.folders.some((folder) => folder.id === id)) assignments[slug] = id;
  return { ...manifest, assignments };
}

/** A renamed chat keeps its folder AND its manual position — both the
 * assignment key and any order entry follow the slug. */
export function migrateChatFolderSlug(
  manifest: ChatFoldersManifest,
  oldSlug: string,
  newSlug: string,
): ChatFoldersManifest {
  const assigned = manifest.assignments[oldSlug];
  if (!assigned) return manifest;
  const assignments = { ...manifest.assignments };
  delete assignments[oldSlug];
  assignments[newSlug] = assigned;
  const order = Object.fromEntries(
    Object.entries(manifest.order).map(([folderId, slugs]) => [
      folderId,
      slugs.map((slug) => (slug === oldSlug ? newSlug : slug)),
    ]),
  );
  return { ...manifest, assignments, order };
}

export interface GroupedChats<T> {
  folders: { folder: ChatFolder; chats: T[] }[];
  loose: T[];
}

/** Project the flat chat list through the manifest: PINNED folders first, then
 * the rest by their newest chat activity, each with its chats in LIST order, then
 * everything unassigned.
 *
 * List order is the caller's pinned-then-recency sort, and it now rules inside
 * folders too (the maintainer, 2026-08-03: "the moment I get a response it should move
 * to the top of the folder / top of the left bar"). The old per-folder MANUAL
 * drag order is retired by that ask — the `order` field stays parsed for
 * manifest compatibility but no longer changes rendering. */
/** A chat's place in the recency order: when its newest REPLY landed, so a
 * send (which writes the person's turn at once) leaves it where it is and the
 * arriving answer lifts it (the owner, 2026-10-15). A chat with no reply yet —
 * or one written before reply times were read — falls back to its file time. */
export function chatActivityMs(chat: { modifiedMs?: number; repliedMs?: number }): number {
  return chat.repliedMs && chat.repliedMs > 0
    ? chat.repliedMs
    : (chat.modifiedMs ?? Number.NEGATIVE_INFINITY);
}

/** Pinned first, then newest activity first; ties keep their incoming order. */
export function sortChatsByActivity<T extends { pinned: boolean; modifiedMs?: number; repliedMs?: number }>(
  chats: readonly T[],
): T[] {
  return [...chats].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || chatActivityMs(b) - chatActivityMs(a),
  );
}

export function groupChats<T extends { slug: string; modifiedMs?: number; repliedMs?: number }>(
  chats: readonly T[],
  manifest: ChatFoldersManifest,
): GroupedChats<T> {
  const byFolder = new Map<string, T[]>(manifest.folders.map((folder) => [folder.id, []]));
  const loose: T[] = [];
  for (const chat of chats) {
    const assigned = manifest.assignments[chat.slug];
    const bucket = assigned ? byFolder.get(assigned) : undefined;
    if (bucket) bucket.push(chat);
    else loose.push(chat);
  }
  const manifestRank = new Map(manifest.folders.map((folder, index) => [folder.id, index]));
  const newest = (folder: ChatFolder) =>
    Math.max(...(byFolder.get(folder.id) ?? []).map(chatActivityMs), Number.NEGATIVE_INFINITY);
  const ranked = [...manifest.folders].sort((a, b) => {
    const pinRank = Number(b.pinned === true) - Number(a.pinned === true);
    if (pinRank !== 0) return pinRank;
    if (!a.pinned && !b.pinned) {
      const aNewest = newest(a);
      const bNewest = newest(b);
      if (aNewest !== bNewest) return bNewest > aNewest ? 1 : -1;
    }
    return (manifestRank.get(a.id) ?? 0) - (manifestRank.get(b.id) ?? 0);
  });
  return {
    folders: ranked.map((folder) => ({
      folder,
      chats: byFolder.get(folder.id) ?? [],
    })),
    loose,
  };
}

export interface VersionedChatFolders {
  manifest: ChatFoldersManifest;
  revision: string;
}

export async function loadChatFolders(instance: MemexInstance): Promise<VersionedChatFolders> {
  const opened = await memexChatFolders(instance.root);
  return {
    manifest: parseChatFolders(opened.contents),
    revision: opened.revision,
  };
}

export async function saveChatFolders(
  instance: MemexInstance,
  manifest: ChatFoldersManifest,
  expectedRevision: string,
): Promise<string> {
  return memexWriteChatFolders(instance.root, serializeChatFolders(manifest), expectedRevision);
}

/** Drop assignments for chats a COMPLETE listing lacks. `listed` null (no
 * listing, or one that failed) or empty prunes nothing: an empty answer is
 * never trusted to mean every chat is gone. The legacy `order` is left as
 * older builds wrote it. */
export function pruneAssignments(
  manifest: ChatFoldersManifest,
  listed: readonly string[] | null,
): ChatFoldersManifest {
  if (!listed || listed.length === 0) return manifest;
  const alive = new Set(listed);
  const kept = Object.entries(manifest.assignments).filter(([slug]) => alive.has(slug));
  if (kept.length === Object.keys(manifest.assignments).length) return manifest;
  return { ...manifest, assignments: Object.fromEntries(kept) };
}

/** The project write path every editor shares: a FRESH manifest (so two quick
 * edits never clobber each other through a stale snapshot), then a fresh chat
 * listing, the edit, the prune, and a save under the revision read. The
 * listing comes after the manifest load: a chat's file is written before it
 * is ever assigned, so an assignment read above lacks a listed file only when
 * its chat is really gone. A listing that fails prunes nothing (Rust reports
 * an unreadable chats folder as an error, never as an empty list). */
export async function updateChatProjects(
  instance: MemexInstance,
  mutate: (manifest: ChatFoldersManifest) => ChatFoldersManifest,
): Promise<ChatFoldersManifest> {
  const fresh = await loadChatFolders(instance);
  const listed = await memexListChats(instance.root).then(
    (rows) => rows.map((row) => row.slug),
    () => null,
  );
  const next = pruneAssignments(mutate(fresh.manifest), listed);
  await saveChatFolders(instance, next, fresh.revision);
  await invalidateChatFolders();
  return next;
}

export const CHAT_FOLDERS_KEY = ["chat-folders"] as const;

export async function invalidateChatFolders(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: CHAT_FOLDERS_KEY });
}
