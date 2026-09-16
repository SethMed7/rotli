// The chat world's data seam. Two callers need it and they must agree:
//
//   • the CHAT front renders the folders and their chats;
//   • the sidebar SHELL's collapse-all needs the folder keys, because chat
//     folders default OPEN and a wiped map would re-EXPAND them (#83).
//
// One react-query key means the second caller is a cache read, not a fetch.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type MemexChatSummary, hasDurableCorpus } from "../../lib/tauri";
import { type MemexInstance, activeInstance } from "../../memex/config";
import { useInstanceChats, useMemexConfig } from "../../memex/useMemex";
import {
  CHAT_FOLDERS_KEY,
  type ChatFoldersManifest,
  EMPTY_CHAT_FOLDERS,
  type GroupedChats,
  groupChats,
  invalidateChatFolders,
  loadChatFolders,
  saveChatFolders,
} from "../../services/chatFolders";
import { useUiStore } from "../../state/ui";

/** The reserved expandedDests key a chat folder's disclosure lives under. */
export function chatFolderKey(id: string): string {
  return `chatfolder:${id}`;
}

export interface SidebarChatData {
  /** The vault whose chats/ these are — null until a vault is configured. */
  activeMemex: MemexInstance | null;
  /** Pinned first, then most-recent (the maintainer, 2026-07-30). */
  chatList: MemexChatSummary[];
  manifest: ChatFoldersManifest;
  grouped: GroupedChats<MemexChatSummary>;
  /** Every folder's expandedDests key — the collapse-all default-open set. */
  folderKeys: string[];
  /** Read-modify-write from a FRESH load so two quick actions never clobber
   * each other through a stale react-query snapshot. Failures land in the
   * sidebar's inline error lane (the menu that launched them is long gone). */
  update: (mutate: (manifest: ChatFoldersManifest) => ChatFoldersManifest, after?: () => void) => void;
}

export function useChatFolders(): SidebarChatData {
  const memexCfg = useMemexConfig();
  const activeMemex = memexCfg.data ? activeInstance(memexCfg.data) : null;
  const rawChats = useInstanceChats(activeMemex).data;
  const chatList = useMemo(
    () =>
      [...(rawChats ?? [])].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.modifiedMs - a.modifiedMs,
      ),
    [rawChats],
  );
  const foldersQuery = useQuery({
    queryKey: [...CHAT_FOLDERS_KEY, activeMemex?.root ?? ""],
    // the vault answers on the desktop and in Rotli Web alike; only the
    // in-memory twin has no chat folders
    enabled: !!activeMemex && hasDurableCorpus(),
    queryFn: () => loadChatFolders(activeMemex!),
  });
  const manifest = foldersQuery.data?.manifest ?? EMPTY_CHAT_FOLDERS;
  const grouped = useMemo(() => groupChats(chatList, manifest), [chatList, manifest]);
  const folderKeys = useMemo(
    () => manifest.folders.map((folder) => chatFolderKey(folder.id)),
    [manifest.folders],
  );
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  const update: SidebarChatData["update"] = (mutate, after) => {
    if (!activeMemex) return;
    setRowActionError(null);
    void loadChatFolders(activeMemex)
      .then((fresh) => saveChatFolders(activeMemex, mutate(fresh.manifest), fresh.revision))
      .then(() => invalidateChatFolders())
      .then(() => after?.())
      .catch((err) =>
        setRowActionError(
          `Couldn’t update chat folders — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  };
  return { activeMemex, chatList, manifest, grouped, folderKeys, update };
}
