// Chat folders — VIRTUAL grouping for the sidebar's Chat section (the maintainer,
// 2026-07-30: "folders with chats in them"). Chats stay flat on disk in
// chats/; the grouping is a rebuildable `.rotli/chat-folders.json` projection
// per memex instance, in the spirit of Main: organization is a view, never a
// second store. Pure manifest logic lives here (unit-tested); the two thin
// I/O helpers ride lib/tauri's memex bridge.

import { memexChatFolders, memexWriteChatFolders } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import { queryClient } from "./query";

export interface ChatFolder {
  id: string;
  name: string;
  /** A pinned folder floats above the others (the maintainer, 2026-08-03). Additive
   * field: absent reads as unpinned. */
  pinned?: boolean;
}

export interface ChatFoldersManifest {
  version: 1;
  folders: ChatFolder[];
  /** chat slug → folder id. Slugs that no longer exist are ignored on render
   * and pruned on the next write. */
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

/** Parse a manifest defensively — any malformed shape reads as empty (the
 * sidecar is rebuildable; garbage must never break the chat list). */
export function parseChatFolders(raw: string): ChatFoldersManifest {
  if (!raw.trim()) return structuredClone(EMPTY_CHAT_FOLDERS);
  try {
    const parsed = JSON.parse(raw) as Partial<ChatFoldersManifest>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.folders)) return structuredClone(EMPTY_CHAT_FOLDERS);
    const folders = parsed.folders
      .filter(
        (folder): folder is ChatFolder =>
          !!folder && typeof folder.id === "string" && typeof folder.name === "string",
      )
      .map((folder) => (folder.pinned === true ? folder : { id: folder.id, name: folder.name }));
    const ids = new Set(folders.map((folder) => folder.id));
    const assignments: Record<string, string> = {};
    for (const [slug, folderId] of Object.entries(parsed.assignments ?? {})) {
      if (typeof folderId === "string" && ids.has(folderId)) assignments[slug] = folderId;
    }
    const order: Record<string, string[]> = {};
    for (const [folderId, slugs] of Object.entries(parsed.order ?? {})) {
      if (!ids.has(folderId) || !Array.isArray(slugs)) continue;
      order[folderId] = slugs.filter((slug): slug is string => typeof slug === "string");
    }
    return { version: 1, folders, assignments, order };
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
  const trimmed = name.trim() || "New folder";
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
      folder.id !== id ? folder : pinned ? { ...folder, pinned: true } : { id: folder.id, name: folder.name },
    ),
  };
}

/** Deleting a folder frees its chats back to the loose list — never touches files. */
export function deleteChatFolder(manifest: ChatFoldersManifest, id: string): ChatFoldersManifest {
  return {
    version: 1,
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
export function groupChats<T extends { slug: string; modifiedMs?: number }>(
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
    Math.max(
      ...(byFolder.get(folder.id) ?? []).map((chat) => chat.modifiedMs ?? Number.NEGATIVE_INFINITY),
      Number.NEGATIVE_INFINITY,
    );
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

// ── I/O (memex bridge) ────────────────────────────────────────────────────────

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

export const CHAT_FOLDERS_KEY = ["chat-folders"] as const;

export async function invalidateChatFolders(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: CHAT_FOLDERS_KEY });
}
