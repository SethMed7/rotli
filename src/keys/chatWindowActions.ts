// Keys for the Chat window (1.3.0). Registered from ./actions.ts with everything
// else; kept here so actions.ts stays under its size ceiling.
//
// The chat window runs the same bundle and the same registry, but answers only
// what makes sense there: main's tab and pane chords and "New chat" are opted
// in by id (alsoOnSurface) — never `shared`, which would fire them in Quick and
// Capture too. No note command, no palette, no view switcher reaches it.

import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { popOutChat, regroupChat } from "../state/chatWindow";
import { useChatWindowStore, windowSurface } from "../state/chatWindowStore";
import { useUiStore } from "../state/ui";
import { alsoOnSurface, dispatch, getAction, registerAction } from "./registry";

/** main's actions that also belong to a window made of chat tabs */
const ALSO_IN_CHAT_WINDOW = [
  "tabs.close",
  "tabs.cycle",
  "tabs.cyclePrev",
  "tabs.reopen",
  "tabs.last",
  ...Array.from({ length: 8 }, (_unused, index) => `tabs.jump${index + 1}`),
  "panes.splitRight",
  "panes.splitDown",
  "panes.focusLeft",
  "panes.focusRight",
  "panes.focusUp",
  "panes.focusDown",
  "panes.close",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomReset",
  "chrome.toggleSidebars",
  "chat.new",
];

/** main's "new tab" actions, which make a new chat in the chat window */
const NEW_MEANS_NEW_CHAT = ["tabs.new", "tabs.newChooser"];

export function registerChatWindowActions(): void {
  if (!LAUNCH_FEATURES.chatWindow) return;
  for (const id of ALSO_IN_CHAT_WINDOW) alsoOnSurface(id, "chat");

  // ⌘T and ⌘N mean "new" wherever you are; in a window made of chats, new is a
  // chat (the owner, 2026-09-21). Wrapping main's actions keeps their chords —
  // rebound ones included — and changes nothing in main.
  for (const id of NEW_MEANS_NEW_CHAT) {
    const action = getAction(id);
    if (!action) continue;
    registerAction({
      ...action,
      also: [...(action.also ?? []), "chat"],
      run: () => (windowSurface() === "chat" ? dispatch("chat.new") : action.run()),
    });
  }

  // One action, read from where you are: in main it pulls Chat out (or brings
  // it back when it is already out); in the chat window it regroups.
  registerAction({
    id: "chat.window",
    title: "Pull Chat out into its own window / bring it back",
    defaultChord: null,
    also: ["chat"],
    run: () => {
      if (windowSurface() === "chat" || useChatWindowStore.getState().detached) regroupChat();
      else {
        const blocked = popOutChat();
        if (blocked) useUiStore.getState().setRowActionError(blocked);
      }
    },
  });

  // Esc in the chat window only unwinds what is open on top (a menu, a picker).
  // It never hides the window: main's app.hide is not opted in here.
  registerAction({
    id: "chatWindow.dismiss",
    title: "Chat window — dismiss what is open",
    defaultChord: "Esc",
    surface: "chat",
    transient: true,
    run: () => void useUiStore.getState().closeTopTransient(),
  });
}
