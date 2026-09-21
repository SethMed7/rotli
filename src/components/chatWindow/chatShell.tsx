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

import { type CSSProperties, useEffect } from "react";

import { dispatch } from "../../keys/registry";
import { attachChatShell, dragChatWindow, zoomChatWindow } from "../../services/chatWindowShell";
import { regroupChat } from "../../state/chatWindow";
import { leaves, usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { ContextMenu } from "../contextMenu";
import { FileNotice } from "../fileNotice";
import { ChatGlyph, PlusGlyph } from "../glyphs";
import { IconButton } from "../iconButton";
import { PaneTree } from "../paneTree";
import { RenameDialog } from "../renameDialog";
import { SidebarChat } from "../sidebar/sidebarChat";
import { useChatFolders } from "../sidebar/useChatFolders";
import { RegroupGlyph } from "./windowGlyphs";

export function ChatShell() {
  const sidebarZoom = useUiStore((state) => state.sidebarZoom);
  const rowActionError = useUiStore((state) => state.rowActionError);
  const setRowActionError = useUiStore((state) => state.setRowActionError);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const railVars = { "--sidebar-w": `${sidebarWidth}px` } as CSSProperties;
  const chats = useChatFolders();
  const empty = usePanesStore((state) => leaves(state.root).every((leaf) => leaf.tabs.length === 0));

  // this window's front is Chat, always — the stores are this webview's own
  useEffect(() => {
    useUiStore.getState().setSidebarView("chat");
    useUiStore.getState().setContentView("panes");
  }, []);

  useEffect(() => attachChatShell({ closeTab: () => dispatch("tabs.close") }), []);

  return (
    <div className="app-window chat-window">
      <header className="titlebar">
        <div
          className="tb-inset"
          onMouseDown={(event) => {
            if (event.button === 0 && event.detail <= 1) dragChatWindow();
          }}
          onDoubleClick={zoomChatWindow}
        />
        <div
          className="tb-mid chat-window-title"
          onMouseDown={(event) => {
            if (event.button === 0 && event.detail <= 1) dragChatWindow();
          }}
          onDoubleClick={zoomChatWindow}
        >
          <ChatGlyph size={14} />
          <span>Chat</span>
        </div>
        <div className="tb-actions">
          <IconButton label="New chat" hotkey="chat.new" onClick={() => dispatch("chat.new")}>
            <PlusGlyph size={16} />
          </IconButton>
          <IconButton className="tb-trail" label="Put Chat back in the main window" onClick={regroupChat}>
            <RegroupGlyph size={16} />
          </IconButton>
        </div>
      </header>
      <main className="app-content">
        <div className="threepane" style={railVars} data-sidebar-side="left">
          <div className="rail-wrap">
            <aside className="sidebar chat-window-rail" aria-label="Chats">
              {rowActionError && (
                <div className="sb-error" role="alert">
                  <span className="sb-error-text">⚠ {rowActionError}</span>
                  <button
                    type="button"
                    className="sb-error-x"
                    aria-label="Dismiss"
                    onClick={() => setRowActionError(null)}
                  >
                    ×
                  </button>
                </div>
              )}
              <SidebarChat chats={chats} zoom={sidebarZoom} />
            </aside>
          </div>
          {empty ? (
            <div className="list-empty empty-stage">
              <div className="et">No chat open</div>
              <div className="es">Pick a chat on the left, or start a new one.</div>
              <button type="button" className="btn" onClick={() => dispatch("chat.new")}>
                <PlusGlyph size={14} />
                New chat
              </button>
            </div>
          ) : (
            <PaneTree />
          )}
        </div>
      </main>
      <FileNotice />
      <ContextMenu />
      <RenameDialog />
    </div>
  );
}
