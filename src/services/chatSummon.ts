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

export async function summonChat(): Promise<void> {
  await showMainWindow();
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
