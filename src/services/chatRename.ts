// Inline chat rename, shared by the tab (Seth, 2026-07-07). Mirrors boardRename:
// `renamingChatSlug` lives in the ui store so a right-click "Rename…" or a tab
// double-click target the same inline input. Commit renames chats/<slug>.md on
// disk (memex_rename_chat) and re-points any open chat tab to the new slug.

import { useCallback } from "react";

import { activeInstance } from "../memex/config";
// the ONE chat-slug generator — same law as chat creation (60-cap included),
// and every output passes the Rust safe_slug wire validator.
import { slugify } from "../memex/contract";
import { renameChat } from "../memex/service";
import { invalidateMemex, useMemexConfig } from "../memex/useMemex";
import { usePanesStore } from "../state/panes";
import { chatKey, retargetChatMapKeys, useUiStore } from "../state/ui";
import { useViewsStore } from "../state/views";
import {
  invalidateChatFolders,
  loadChatFolders,
  migrateChatFolderSlug,
  saveChatFolders,
} from "./chatFolders";
import { migrateChatViewSlug } from "./viewTree";

export function useChatRename() {
  const renamingChatSlug = useUiStore((s) => s.renamingChatSlug);
  const setRenamingChatSlug = useUiStore((s) => s.setRenamingChatSlug);
  const retargetChat = usePanesStore((s) => s.retargetChat);
  const cfg = useMemexConfig();

  const commit = useCallback(
    async (oldSlug: string, raw: string) => {
      setRenamingChatSlug(null);
      const newSlug = slugify(raw);
      if (!newSlug || newSlug === oldSlug) return;
      const active = cfg.data ? activeInstance(cfg.data) : null;
      if (!active) return;
      try {
        const finalSlug = await renameChat(active, oldSlug, newSlug);
        retargetChat(oldSlug, finalSlug);
        // the chat keeps its model/provider pick, globe, and measure — a rename
        // used to orphan these maps under the old key (audit 2026-08-03)
        retargetChatMapKeys(chatKey(active.id, oldSlug, ""), chatKey(active.id, finalSlug, ""));
        // …and its named-view membership (chats in views, 2026-08-03)
        const views = useViewsStore.getState();
        if (views.hydrated && views.writable) {
          const migrated = migrateChatViewSlug(views.manifest, oldSlug, finalSlug);
          if (migrated !== views.manifest) views.setManifest(migrated);
        }
        // the chat keeps its folder — the assignment key follows the slug
        try {
          const manifest = await loadChatFolders(active);
          const migrated = migrateChatFolderSlug(manifest, oldSlug, finalSlug);
          if (migrated !== manifest) {
            await saveChatFolders(active, migrated);
            await invalidateChatFolders();
          }
        } catch {
          /* the grouping sidecar is best-effort — a rename never fails on it */
        }
        await invalidateMemex();
      } catch {
        /* read-only, gone, or name taken — leave the chat as it was */
      }
    },
    [setRenamingChatSlug, retargetChat, cfg.data],
  );

  return {
    renamingChatSlug,
    start: (slug: string) => setRenamingChatSlug(slug),
    commit,
    cancel: () => setRenamingChatSlug(null),
  };
}
