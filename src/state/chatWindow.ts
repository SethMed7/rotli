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
// A RUNNING chat cannot move: its turn lives in the origin webview's memory
// (refs, a stream channel bound to that webview), so moving it would orphan the
// reply and leave the model process running for nothing. Pop-out says so
// instead.

import {
  hideChatWindow,
  onChatWindow,
  onChatWindowCloseRequest,
  onChatWindowShown,
  sendChatWindow,
  showChatWindow,
} from "../lib/chatWindowBridge";
import { fileNoteInNamedRootFolder, addNoteToMain, type MainNode } from "../services/mainTree";
import { chatDraftFor, useChatDrafts } from "./chatDrafts";
import { useChatRuns } from "./chatRuns";
import { useChatWindowStore, windowSurface } from "./chatWindowStore";
import { type ChatTabRef, type DraftOf, movableChatTabs, savedChatRefs } from "./chatWindowTabs";
import { useMainStore } from "./main";
import { activeTabOf, findLeaf, usePanesStore } from "./panes";

export const POP_OUT_BLOCKED =
  "A chat is still answering. Let it finish, then pull Chat out — a reply can’t follow its chat to another window.";

/** Why Chat cannot be pulled out right now, or null. */
export function popOutBlocker(): string | null {
  const running = Object.values(useChatRuns.getState().runs).some((state) => state === "running");
  return running ? POP_OUT_BLOCKED : null;
}

const draftOf: DraftOf = (tabId) => {
  const draft = chatDraftFor(useChatDrafts.getState().drafts, tabId);
  return { message: draft.message, images: draft.images.length };
};

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

/** Open handed-over chats in THIS window, each with the text it carried. */
function openRefs(refs: readonly ChatTabRef[]): void {
  for (const ref of refs) {
    const panes = usePanesStore.getState();
    panes.openChat(ref.slug, { newTab: true, ...(ref.vaultId ? { vaultId: ref.vaultId } : {}) });
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

/** Additions computed by a window that never hydrated Main: merge them into the
 * real tree (a chat's artifact under its folder; a loose note at the root). */
function fileIntoMain(fragment: readonly MainNode[]): void {
  const main = useMainStore.getState();
  let tree = main.manifest.tree;
  for (const node of fragment) {
    if ("note" in node) tree = addNoteToMain(tree, node.note);
    else {
      for (const child of node.children) {
        if ("note" in child) tree = fileNoteInNamedRootFolder(tree, child.note, node.folder);
      }
    }
  }
  if (tree !== main.manifest.tree) main.setTree(tree);
}

/** Attach this webview's half of the protocol. Returns the teardown. */
export function attachChatWindow(): () => void {
  const surface = windowSurface();
  if (surface === "main") {
    return onChatWindow((message) => {
      const store = useChatWindowStore.getState();
      if (message.kind === "tabs") store.setRefs(message.refs);
      else if (message.kind === "file-into-main") fileIntoMain(message.tree);
      else if (message.kind === "regrouped") {
        store.setDetached(false);
        openRefs(message.refs);
      }
    });
  }
  if (surface !== "chat") return () => {};

  const currentRefs = () => savedChatRefs(usePanesStore.getState().root);
  const report = () => sendChatWindow({ kind: "tabs", refs: currentRefs() });
  // the window is about to hide: EVERYTHING goes back (force), so no chat is
  // ever stranded in a window nobody can see
  const handBack = () => {
    sendChatWindow({ kind: "regrouped", refs: takeChatTabs(true) });
    void hideChatWindow();
  };
  const offMessages = onChatWindow((message) => {
    if (message.kind === "open") openRefs(message.refs);
    else if (message.kind === "regroup") handBack();
  });
  const offClose = onChatWindowCloseRequest(handBack);
  // shown again: tell main what is here, so its saved layout starts in step
  const offShown = onChatWindowShown(report);
  // every change to the open chats is reported, so main's saved layout follows
  let last = JSON.stringify(currentRefs());
  const offPanes = usePanesStore.subscribe(() => {
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
