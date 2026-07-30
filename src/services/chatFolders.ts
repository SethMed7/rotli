// Chat folders — VIRTUAL grouping for the sidebar's Chat section (Seth,
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
}

export interface ChatFoldersManifest {
  version: 1;
  folders: ChatFolder[];
  /** chat slug → folder id. Slugs that no longer exist are ignored on render
   * and pruned on the next write. */
  assignments: Record<string, string>;
}

export const EMPTY_CHAT_FOLDERS: ChatFoldersManifest = { version: 1, folders: [], assignments: {} };

/** Parse a manifest defensively — any malformed shape reads as empty (the
 * sidecar is rebuildable; garbage must never break the chat list). */
export function parseChatFolders(raw: string): ChatFoldersManifest {
  if (!raw.trim()) return structuredClone(EMPTY_CHAT_FOLDERS);
  try {
    const parsed = JSON.parse(raw) as Partial<ChatFoldersManifest>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.folders)) return structuredClone(EMPTY_CHAT_FOLDERS);
    const folders = parsed.folders.filter(
      (folder): folder is ChatFolder =>
        !!folder && typeof folder.id === "string" && typeof folder.name === "string",
    );
    const ids = new Set(folders.map((folder) => folder.id));
    const assignments: Record<string, string> = {};
    for (const [slug, folderId] of Object.entries(parsed.assignments ?? {})) {
      if (typeof folderId === "string" && ids.has(folderId)) assignments[slug] = folderId;
    }
    return { version: 1, folders, assignments };
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
    manifest: { ...manifest, folders: [...manifest.folders, { id, name: trimmed }] },
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

/** Deleting a folder frees its chats back to the loose list — never touches files. */
export function deleteChatFolder(manifest: ChatFoldersManifest, id: string): ChatFoldersManifest {
  return {
    version: 1,
    folders: manifest.folders.filter((folder) => folder.id !== id),
    assignments: Object.fromEntries(
      Object.entries(manifest.assignments).filter(([, assigned]) => assigned !== id),
    ),
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

/** A renamed chat keeps its folder — the assignment key follows the slug. */
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
  return { ...manifest, assignments };
}

export interface GroupedChats<T> {
  folders: { folder: ChatFolder; chats: T[] }[];
  loose: T[];
}

/** Project the flat chat list through the manifest: folders (in manifest
 * order) with their chats, then everything unassigned, original order kept. */
export function groupChats<T extends { slug: string }>(
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
  return {
    folders: manifest.folders.map((folder) => ({ folder, chats: byFolder.get(folder.id) ?? [] })),
    loose,
  };
}

// ── I/O (memex bridge) ────────────────────────────────────────────────────────

export async function loadChatFolders(instance: MemexInstance): Promise<ChatFoldersManifest> {
  return parseChatFolders(await memexChatFolders(instance.root));
}

export async function saveChatFolders(instance: MemexInstance, manifest: ChatFoldersManifest): Promise<void> {
  await memexWriteChatFolders(instance.root, serializeChatFolders(manifest));
}

export const CHAT_FOLDERS_KEY = ["chat-folders"] as const;

export async function invalidateChatFolders(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: CHAT_FOLDERS_KEY });
}
