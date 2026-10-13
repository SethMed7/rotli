// The Chat window's shell (1.3.0): Chat pulled out of main's Home | Chat switch
// into a window of its own. Same bundle (`index.html?window=chat`), but it shows
// only what belongs to Chat — the chat sidebar and panes whose tabs are chats.
// No Home, no Breve, no System, no settings, no onboarding: main is where those
// live, and main can never be pulled out.
//
// This window WRITES nothing but chats. Main stays the one writer of viewstate,
// settings and Main (state/chatWindow.ts reports what main must record). It
// does listen for vault changes itself: a shell that never hears
// `rotli:corpus-changed` shows a stale chat and then fails its next save.

import { useEffect } from "react";

import { dispatch } from "../../keys/registry";
import { attachChatShell, dragChatWindow, zoomChatWindow } from "../../services/chatWindowShell";
import { regroupChat } from "../../state/chatWindow";
import { leaves, usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { ChatGlyph, PlusGlyph, SidebarGlyph } from "../glyphs";
import { IconButton } from "../iconButton";
import { RenameDialog } from "../renameDialog";
import { SidebarChat } from "../sidebar/sidebarChat";
import { useChatFolders } from "../sidebar/useChatFolders";
import { SideWindowFrame } from "../sideWindowFrame";
import { RegroupGlyph } from "./windowGlyphs";

export function ChatShell() {
  const sidebarZoom = useUiStore((state) => state.sidebarZoom);
  // the same sidebar toggle as main (the owner, 2026-09-21): this window's own
  // store, so hiding the chat list here never hides main's sidebar
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const chats = useChatFolders();
  const empty = usePanesStore((state) => leaves(state.root).every((leaf) => leaf.tabs.length === 0));

  // this window's front is Chat, always — the stores are this webview's own
  useEffect(() => {
    useUiStore.getState().setSidebarView("chat");
    useUiStore.getState().setContentView("panes");
  }, []);

  useEffect(() => attachChatShell({ closeTab: () => dispatch("tabs.close") }), []);

  return (
    <SideWindowFrame
      className="chat-window"
      drag={dragChatWindow}
      zoom={zoomChatWindow}
      lead={
        <IconButton
          className="tb-lead"
          label={sidebarCollapsed ? "Show sidebar — ⌘0" : "Hide sidebar — ⌘0"}
          hotkey="chrome.toggleSidebars"
          onClick={() => dispatch("chrome.toggleSidebars")}
        >
          <SidebarGlyph size={16} />
        </IconButton>
      }
      title={
        <>
          <ChatGlyph size={14} />
          <span>Chat</span>
        </>
      }
      actions={
        <IconButton
          className="tb-trail"
          label="New chat"
          hotkey="chat.new"
          onClick={() => dispatch("chat.new")}
        >
          <PlusGlyph size={16} />
        </IconButton>
      }
      rail={
        sidebarCollapsed ? null : (
          <>
            {/* where main has its Home | Chat switch, this window has its way
              home (the owner, 2026-09-21) */}
            <button type="button" className="chat-window-regroup" onClick={regroupChat}>
              <RegroupGlyph size={14} />
              Put Chat back in the main window
            </button>
            <SidebarChat chats={chats} zoom={sidebarZoom} />
          </>
        )
      }
      railLabel="Chats"
      railClassName="chat-window-rail"
      empty={
        empty
          ? {
              title: "No chat open",
              body: "Pick a chat on the left, or start a new one.",
              action: (
                <button type="button" className="btn" onClick={() => dispatch("chat.new")}>
                  <PlusGlyph size={14} />
                  New chat
                </button>
              ),
            }
          : null
      }
    >
      <RenameDialog />
    </SideWindowFrame>
  );
}
