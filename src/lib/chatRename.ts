// Inline chat rename, shared by the tab (Seth, 2026-07-07). Mirrors boardRename:
// `renamingChatSlug` lives in the ui store so a right-click "Rename…" or a tab
// double-click target the same inline input. Commit renames chats/<slug>.md on
// disk (memex_rename_chat) and re-points any open chat tab to the new slug.

import { useCallback } from "react";
import { activeInstance } from "../memex/config";
import { renameChat } from "../memex/service";
import { invalidateMemex, useMemexConfig } from "../memex/useMemex";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";

/** Display name → chat slug (lowercase-alnum-dash), matching the Rust safe_slug. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
