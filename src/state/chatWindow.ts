// The effects behind "Pull Chat out into its own window" (1.3.0).
//
//   pop out  (main)  saved chat tabs leave main's panes and open in the window
//   regroup  (either) the window hands its chats back, then hides
//
// Main stays the ONE writer: the chat webview never writes viewstate, settings
// or main.json (persist.ts and main.ts already refuse off-main). It REPORTS its
// open chats, and main folds them into the layout it saves (viewstate.ts), so a
// quit with the window up loses nothing — the next launch finds them regrouped.
//
// A RUNNING chat cannot move — in EITHER direction: its turn lives in the
// webview it runs in (refs, a stream channel bound to that webview), so moving
// it would orphan the reply and leave the model process running for nothing.
// Pop-out and regroup both say so instead.
//
// One chat is never open in both windows (two writers on one transcript): a
// draft holding images cannot cross webviews, so pop-out waits for it rather
// than leave that tab behind; and while Chat is out, any chat tab that turns up
// in main anyway (a split, ⌘⇧T) is moved to the window at once.

import {
  hideChatWindow,
  onChatWindow,
  onChatWindowCloseRequest,
  onChatWindowShown,
  sendChatWindow,
  showChatWindow,
} from "../lib/chatWindowBridge";
import type { MainNode } from "../services/mainTree";
import { chatDraftFor, useChatDrafts } from "./chatDrafts";
import { useChatRuns } from "./chatRuns";
import { useChatWindowStore, windowSurface } from "./chatWindowStore";
import { type ChatTabRef, type DraftOf, movableChatTabs, savedChatRefs } from "./chatWindowTabs";
import { activeTabOf, findLeaf, leaves, usePanesStore } from "./panes";
import { useUiStore } from "./ui";

export const POP_OUT_BLOCKED =
  "A chat is still answering. Let it finish, then pull Chat out — a reply can’t follow its chat to another window.";

export const POP_OUT_IMAGES =
  "A chat has images waiting to be sent. Send or remove them, then pull Chat out — images can’t move to another window.";

export const REGROUP_BLOCKED =
  "A chat is still answering. Let it finish, then put Chat back — a reply can’t follow its chat to another window.";

const draftOf: DraftOf = (tabId) => {
  const draft = chatDraftFor(useChatDrafts.getState().drafts, tabId);
  return { message: draft.message, images: draft.images.length };
};

const anyRunning = () => Object.values(useChatRuns.getState().runs).some((state) => state === "running");

/** Why Chat cannot be pulled out right now, or null. */
export function popOutBlocker(): string | null {
  if (anyRunning()) return POP_OUT_BLOCKED;
  const root = usePanesStore.getState().root;
  const withImages = movableChatTabs(root, draftOf, true).length > movableChatTabs(root, draftOf).length;
  return withImages ? POP_OUT_IMAGES : null;
}

/** Take the movable chat tabs out of THIS window's panes and return them. */
function takeChatTabs(force: boolean): ChatTabRef[] {
  const panes = usePanesStore.getState();
  const moving = movableChatTabs(panes.root, draftOf, force);
  for (const { paneId, tabId } of moving) {
    // record:false — the tab moved, it was not closed: ⌘⇧T must not bring a
    // second copy back
    panes.closeTabById(paneId, tabId, { record: false });
    useChatDrafts.getState().clear(tabId);
  }
  return moving.map((entry) => entry.ref);
}

/** Open handed-over chats in THIS window, each with the text it carried. A
 * saved chat already open here (in any pane) is brought forward, never opened
 * twice — two tabs on one file would fight over its revision. */
function openRefs(refs: readonly ChatTabRef[]): void {
  for (const ref of refs) {
    const panes = usePanesStore.getState();
    const shown = ref.slug !== null && panes.activateSurface("chat", ref.slug);
    if (!shown) panes.openChat(ref.slug, ref.vaultId ? { vaultId: ref.vaultId } : undefined);
    if (!ref.draft) continue;
    const after = usePanesStore.getState();
    const leaf = findLeaf(after.root, after.focusedPaneId);
    const tab = leaf ? activeTabOf(leaf) : null;
    if (tab?.surfaceKind === "chat" && tab.chatSlug === ref.slug) {
      useChatDrafts.getState().setMessage(tab.id, ref.draft);
    }
  }
}

/** MAIN: move the chat tabs into the chat window and show it. */
export function popOutChat(): string | null {
  const blocked = popOutBlocker();
  if (blocked) return blocked;
  const refs = takeChatTabs(false);
  useChatWindowStore.getState().setDetached(true);
  useChatWindowStore.getState().setRefs(refs);
  // an empty window is a dead end: with nothing to move, start a fresh chat
  sendChatWindow({ kind: "open", refs: refs.length > 0 ? refs : [{ slug: null }] });
  void showChatWindow();
  return null;
}

/** MAIN: ask the window to hand everything back. */
export function regroupChat(): void {
  sendChatWindow({ kind: "regroup" });
}

/** Attach this webview's half of the protocol. Returns the teardown.
 * `fileIntoMain` is main's writer for additions a non-main window computed
 * (state/main.ts addFragmentToMain) — passed in, so this module never loads the
 * Main store. */
export function attachChatWindow(fileIntoMain: (fragment: MainNode[]) => void): () => void {
  const surface = windowSurface();
  if (surface === "main") {
    const offMessages = onChatWindow((message) => {
      const store = useChatWindowStore.getState();
      // a report that lands after the regroup is stale: Chat is home again
      if (message.kind === "tabs") {
        if (store.detached) store.setRefs(message.refs);
      } else if (message.kind === "file-into-main") fileIntoMain(message.tree);
      else if (message.kind === "regrouped") {
        store.setDetached(false);
        openRefs(message.refs);
      }
    });
    // while Chat is out, main holds no chat tab: one that turns up anyway (a
    // split duplicating a tab, ⌘⇧T reopening one) moves to the window at once
    // (closing a tab re-enters this subscription mid-loop, so the sweep is
    // guarded and repeats until main holds no chat tab)
    let sweeping = false;
    const offPanes = usePanesStore.subscribe(() => {
      if (sweeping || !useChatWindowStore.getState().detached) return;
      sweeping = true;
      const strays: ChatTabRef[] = [];
      try {
        for (let taken = takeChatTabs(true); taken.length > 0; taken = takeChatTabs(true))
          strays.push(...taken);
      } finally {
        sweeping = false;
      }
      if (strays.length === 0) return;
      sendChatWindow({ kind: "open", refs: strays });
      void showChatWindow();
    });
    return () => {
      offMessages();
      offPanes();
    };
  }
  if (surface !== "chat") return () => {};

  // THE invariant of this window: its panes hold chat tabs and nothing else.
  // The store boots (and a vault switch resets) with a note placeholder, and
  // any stray open would land here too — so it is enforced, not assumed.
  const keepOnlyChats = () => {
    const panes = usePanesStore.getState();
    for (const leaf of leaves(panes.root)) {
      for (const tab of leaf.tabs) {
        if (tab.surfaceKind !== "chat") panes.closeTabById(leaf.id, tab.id, { record: false });
      }
    }
  };
  keepOnlyChats();
  const currentRefs = () => savedChatRefs(usePanesStore.getState().root);
  const report = () => sendChatWindow({ kind: "tabs", refs: currentRefs() });
  // The window is about to hide: EVERYTHING goes back (force), so no chat is
  // ever stranded in a window nobody can see — unless a chat here is still
  // answering, which cannot move: then the window stays, comes forward, and
  // says why. While handing back, the tab closes must not be REPORTED: an
  // interim empty report reaching main before "regrouped" would drop these
  // chats from the layout main saves (a quit in between would lose them).
  let handingBack = false;
  const handBack = () => {
    if (anyRunning()) {
      useUiStore.getState().setRowActionError(REGROUP_BLOCKED);
      void showChatWindow();
      return;
    }
    handingBack = true;
    try {
      sendChatWindow({ kind: "regrouped", refs: takeChatTabs(true) });
    } finally {
      handingBack = false;
    }
    last = JSON.stringify(currentRefs());
    void hideChatWindow();
  };
  const offMessages = onChatWindow((message) => {
    if (message.kind === "open") openRefs(message.refs);
    else if (message.kind === "regroup") handBack();
  });
  const offClose = onChatWindowCloseRequest(handBack);
  // shown again: tell main what is here, so its saved layout starts in step —
  // but never an EMPTY list: on pop-out "shown" can arrive before the handed-
  // over chats are open, and an empty report would drop them from the layout
  // main saves (the pane subscription reports once they are open)
  const offShown = onChatWindowShown(() => {
    if (currentRefs().length > 0) report();
  });
  // every change to the open chats is reported, so main's saved layout follows
  let last = JSON.stringify(currentRefs());
  const offPanes = usePanesStore.subscribe(() => {
    keepOnlyChats();
    if (handingBack) return;
    const next = JSON.stringify(currentRefs());
    if (next === last) return;
    last = next;
    report();
  });
  return () => {
    offMessages();
    offClose();
    offShown();
    offPanes();
  };
}
