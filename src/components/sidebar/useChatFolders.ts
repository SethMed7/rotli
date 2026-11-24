// The chat world's data seam: the vault's chats, sorted by reply recency, and
// the projects manifest (`.rotli/chat-folders.json`) they are grouped through.
// The Chat front, the chat window, the dashboard, project pages, and tab titles
// all read it; one react-query key means every caller after the first is a
// cache read, not a fetch.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { type MemexChatSummary, chatModels, hasDurableCorpus, isTauri } from "../../lib/tauri";
import { type MemexInstance, activeInstance } from "../../memex/config";
import { useInstanceChats, useMemexConfig } from "../../memex/useMemex";
import { invalidateMemex } from "../../memex/useMemex";
import {
  CHAT_FOLDERS_KEY,
  type ChatFoldersManifest,
  EMPTY_CHAT_FOLDERS,
  type GroupedChats,
  groupChats,
  loadChatFolders,
  sortChatsByActivity,
  updateChatProjects,
} from "../../services/chatFolders";
import { backfillChatModels } from "../../services/chatModelMeta";
import { useUiStore } from "../../state/ui";

/** The projects manifest of one vault — the query every reader shares. */
export function useChatProjectsManifest(activeMemex: MemexInstance | null) {
  return useQuery({
    queryKey: [...CHAT_FOLDERS_KEY, activeMemex?.root ?? ""],
    // the vault answers on the desktop and in Rotli Web alike; only the
    // in-memory twin has no chat projects
    enabled: !!activeMemex && hasDurableCorpus(),
    queryFn: () => loadChatFolders(activeMemex!),
  });
}

export interface SidebarChatData {
  /** The vault whose chats/ these are — null until a vault is configured. */
  activeMemex: MemexInstance | null;
  /** Pinned first, then newest reply (services/chatFolders chatActivityMs). */
  chatList: MemexChatSummary[];
  /** The vault's chats have been read (an empty list then means "no chats yet"). */
  chatsLoaded: boolean;
  manifest: ChatFoldersManifest;
  grouped: GroupedChats<MemexChatSummary>;
  /** The manifest could not be read (the sidebar shows it; chats still list). */
  projectsError: boolean;
  /** One project edit through services/chatFolders updateChatProjects (fresh
   * load, edit, prune, revision-guarded save). Failures land in the sidebar's
   * inline error lane (the menu that launched them is long gone). */
  update: (mutate: (manifest: ChatFoldersManifest) => ChatFoldersManifest, after?: () => void) => void;
}

export function useChatFolders(): SidebarChatData {
  const memexCfg = useMemexConfig();
  const activeMemex = memexCfg.data ? activeInstance(memexCfg.data) : null;
  const rawChats = useInstanceChats(activeMemex).data;
  const chatList = useMemo(() => sortChatsByActivity(rawChats ?? []), [rawChats]);
  const foldersQuery = useChatProjectsManifest(activeMemex);
  const manifest = foldersQuery.data?.manifest ?? EMPTY_CHAT_FOLDERS;
  // chats from before `model:` lived in the file get it once, from this
  // device's settings map (2026-09-17) — then every copy of the vault agrees
  const chatModelMap = useUiStore((s) => s.chatModel);
  const defaultModel = useUiStore((s) => s.chatModelId) ?? "";
  const hybridPresets = useUiStore((s) => s.hybridPresets);
  useEffect(() => {
    if (!activeMemex || !rawChats || !hasDurableCorpus()) return;
    const instance = activeMemex;
    void (isTauri() ? chatModels() : Promise.resolve([]))
      .then((models) =>
        backfillChatModels(instance, rawChats, chatModelMap, defaultModel, models, hybridPresets),
      )
      .then((written) => (written > 0 ? invalidateMemex() : undefined))
      .catch(() => {});
  }, [activeMemex, rawChats, chatModelMap, defaultModel, hybridPresets]);
  const grouped = useMemo(() => groupChats(chatList, manifest), [chatList, manifest]);
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  const update: SidebarChatData["update"] = (mutate, after) => {
    if (!activeMemex) return;
    setRowActionError(null);
    void updateChatProjects(activeMemex, mutate)
      .then(() => after?.())
      .catch((err) =>
        setRowActionError(
          `Couldn’t update chat projects — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  };
  return {
    activeMemex,
    chatList,
    chatsLoaded: rawChats !== undefined,
    manifest,
    grouped,
    projectsError: foldersQuery.isError,
    update,
  };
}
