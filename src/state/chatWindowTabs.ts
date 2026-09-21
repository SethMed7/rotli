// The pure half of the Chat window's tab hand-off (state/chatWindow.ts owns
// the effects). A chat tab is a pointer — a slug and its vault, or no slug yet
// for a fresh one — plus whatever was typed and not sent. Each window keeps its
// session drafts in its own memory, so the unsent TEXT rides along with the
// reference. Image attachments in a draft cannot cross webviews (their sources
// are this window's object URLs), so a tab holding some stays where it is.

import { ulid } from "../services/notes";
import type { ChatTab, LeafNode, PaneNode } from "../types";

export interface ChatTabRef {
  /** null = a fresh chat that has not been sent (no file yet). */
  slug: string | null;
  vaultId?: string;
  /** Unsent composer text that moves with the tab. */
  draft?: string;
}

/** What a window knows about a tab's unsent draft. */
export type DraftOf = (tabId: string) => { message: string; images: number };

const sameChat = (a: ChatTabRef, b: ChatTabRef) =>
  a.slug !== null &&
  a.slug === b.slug &&
  (a.vaultId === undefined || b.vaultId === undefined || a.vaultId === b.vaultId);

function leavesOf(node: PaneNode, out: LeafNode[] = []): LeafNode[] {
  if (node.kind === "leaf") out.push(node);
  else for (const child of node.children) leavesOf(child, out);
  return out;
}

/** The chat tabs that can change windows, in tab order, with the tab that
 * holds each. `force` (regroup: the window is about to hide) moves even a tab
 * with draft images — they are dropped rather than stranded out of sight. */
export function movableChatTabs(
  root: PaneNode,
  draftOf: DraftOf,
  force = false,
): Array<{ paneId: string; tabId: string; ref: ChatTabRef }> {
  return leavesOf(root).flatMap((leaf) =>
    leaf.tabs.flatMap((tab) => {
      if (tab.surfaceKind !== "chat") return [];
      const draft = draftOf(tab.id);
      if (draft.images > 0 && !force) return [];
      const ref: ChatTabRef = {
        slug: tab.chatSlug,
        ...(tab.vaultId ? { vaultId: tab.vaultId } : {}),
        ...(draft.message.trim() ? { draft: draft.message } : {}),
      };
      return [{ paneId: leaf.id, tabId: tab.id, ref }];
    }),
  );
}

/** The SAVED chats open in a tree — what main records in its layout. */
export function savedChatRefs(root: PaneNode): ChatTabRef[] {
  return movableChatTabs(root, () => ({ message: "", images: 0 }), true)
    .map((entry) => entry.ref)
    .filter((ref) => ref.slug !== null);
}

export function uniqueChatRefs(refs: readonly ChatTabRef[]): ChatTabRef[] {
  const out: ChatTabRef[] = [];
  for (const ref of refs) if (ref.slug && !out.some((seen) => sameChat(seen, ref))) out.push(ref);
  return out;
}

/** Main is the one writer of the saved layout. While Chat lives in its own
 * window, the chats open THERE are written into main's layout as ordinary tabs
 * of its first pane — so quitting with the chat window up loses nothing: the
 * next launch simply finds them regrouped. Chats main already shows are not
 * doubled. */
export function withDetachedChats(root: PaneNode, detached: readonly ChatTabRef[]): PaneNode {
  const held = savedChatRefs(root);
  const missing = uniqueChatRefs(detached).filter((ref) => !held.some((seen) => sameChat(seen, ref)));
  if (missing.length === 0) return root;
  const target = leavesOf(root)[0];
  if (!target) return root;
  const extra: ChatTab[] = missing.map((ref) => ({
    id: ulid(),
    surfaceKind: "chat",
    chatSlug: ref.slug,
    ...(ref.vaultId ? { vaultId: ref.vaultId } : {}),
  }));
  const patch = (node: PaneNode): PaneNode => {
    if (node.kind === "split") return { ...node, children: node.children.map(patch) };
    if (node.id !== target.id) return node;
    const tabs = [...node.tabs, ...extra];
    return { ...node, tabs, activeTabId: node.activeTabId || (tabs[0]?.id ?? "") };
  };
  return patch(root);
}
