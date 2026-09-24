// ⌥A from anywhere: surface the main window and land in a chat. Rust already
// showed the window (the chord's handler calls show_main before emitting
// rotli:summon-chat); this side only decides WHICH chat — the focused pane's
// existing chat tab if it has one, else the most recently touched
// chats/<slug>.md in the active memex, else a fresh unsent chat. Every failure
// path degrades to the fresh chat: ⌥A must always land you somewhere to type.

import type { MemexChatSummary } from "../lib/tauri";
import { showMainWindow } from "../lib/tauri";
import { activeInstance } from "../memex/config";
import { listChats, loadConfig } from "../memex/service";
import { openChatForNoteId } from "../noteChat/composition";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";

/** The most recently touched chat, by fs mtime. Ties keep the LIST's order
 * (slug-sorted Rust-side), so the pick is deterministic. null when empty. */
export function newestChatSlug(chats: Pick<MemexChatSummary, "slug" | "modifiedMs">[]): string | null {
  let best: { slug: string; modifiedMs: number } | null = null;
  for (const c of chats) {
    if (!best || c.modifiedMs > best.modifiedMs) best = c;
  }
  return best?.slug ?? null;
}

/** MAIN: ⌘⇧C in the Quick Note, which cannot host a chat — open that note's
 * chat here and bring this window forward (2026-09-24). */
export function openNoteChatFromQuickNote(id: string, create: boolean): void {
  void openChatForNoteId(id, { create })
    .then((opened) => {
      // a note that is gone opens nothing: main stays where it was
      if (!opened) return;
      useUiStore.getState().setSettingsOpen(false);
      return showMainWindow();
    })
    .catch((error: unknown) => {
      // the error shows in main, so main comes forward to say it
      useUiStore
        .getState()
        .setRowActionError(
          `Couldn’t open a chat — ${error instanceof Error ? error.message : String(error)}`,
        );
      void showMainWindow();
    });
}

/** `here`: the summon was routed to THIS window (the Chat window while Chat
 * lives there) — same policy, without bringing main forward. */
export async function summonChat(opts?: { here?: boolean }): Promise<void> {
  if (!opts?.here) await showMainWindow();
  // chat is a pane surface — Settings would sit on top of it (mirrors chat.new)
  useUiStore.getState().setSettingsOpen(false);
  useUiStore.getState().setSidebarMode("notes");
  useUiStore.getState().setSidebarView("chat"); // the summon lands on the Chat front
  const panes = usePanesStore.getState();
  const leaf = findLeaf(panes.root, panes.focusedPaneId) ?? leaves(panes.root)[0];
  const existing = leaf?.tabs.find((t) => t.surfaceKind === "chat");
  if (leaf && existing) {
    // you already have a chat here — return to it, don't stack another
    useUiStore.getState().setContentView("panes");
    panes.activateTab(leaf.id, existing.id);
    return;
  }
  let slug: string | null = null;
  let vaultId: string | undefined;
  try {
    const inst = activeInstance(await loadConfig());
    if (inst) {
      vaultId = inst.id;
      slug = newestChatSlug(await listChats(inst));
    }
  } catch {
    // no memex / listing failed — a fresh chat is still a chat
  }
  panes.openChat(slug, vaultId ? { vaultId } : undefined);
}
