// The tab strip — rendered for EVERY pane now (the maintainer, 2026-06-13): the old
// "single-tab pane shows zero tab chrome" Apple-Notes default is retired, so a
// lone tab is still visible and closeable. 34px on ground, 1px bottom border;
// tabs 96–208px, always-labeled + type glyph; active = surface fill merging
// into the editor; close × on active/hover only, with its space always reserved
// so the strip never reflows. Overflow follows Settings → General: Scroll keeps
// the 96px title floor and pans, while Fit shrinks every tab into the pane.
// Focus is
// marked at the PANE level (the 1px accent ring on `.pane.focused`, multi-pane
// only — the 2026-07-30 removal of the tab's clay top edge moved the cue there);
// unfocused panes also dim their strips.
//
// Tabs drag with POINTER events (the maintainer, 2026-06-15: HTML5 drag is dead in the
// macOS WKWebView shell): drag within a strip to reorder, onto another strip to
// move, or onto a pane edge to split. The gesture + hit-testing live in
// lib/tabDrag; the strip just starts it on pointerdown and reads the store's
// dropPreview to paint the 2px insertion line. Every tab is closeable — the
// last one leaves the lone pane in the quokka rest state (the maintainer, 2026-07-28).

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  closeOtherTabsWithDraftCleanup,
  closeTabWithDraftCleanup,
  closeTabsRightWithDraftCleanup,
} from "../documents/draftComposition";
import { newItemInTab } from "../keys/actions";
import { tabHotkeyAction } from "../keys/tabHotkeys";
import { fileName, fileNameStem } from "../lib/fileKind";
import { hotkeyHint } from "../lib/hotkeyHint";
import {
  privateBrowserTabTitle,
  privateBrowserTitleSnapshot,
  subscribePrivateBrowserTitles,
} from "../lib/privateBrowser";
import { startTabDrag } from "../lib/tabDrag";
import { activeInstance } from "../memex/config";
import { useInstanceChats, useMemexConfig } from "../memex/useMemex";
import { newItemDefinition } from "../newItems/model";
import { useBoardRename } from "../services/boardRename";
import { useChatRename } from "../services/chatRename";
import { useNoteIndex } from "../services/hooks";
import { renameLane } from "../services/itemRename";
import { addNoteToMain, mainHasNote, removeFromMain } from "../services/mainTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useMainStore } from "../state/main";
import { activeTabOf, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { LeafNode, Tab } from "../types";
import {
  BrowserGlyph,
  ChatGlyph,
  ClockGlyph,
  ExcalidrawGlyph,
  FileGlyph,
  PlusGlyph,
  XGlyph,
  glyphForNote,
} from "./glyphs";
import { InlineRenameInput } from "./inlineRenameInput";

/** A board's display label = its filename minus the .excalidraw extension. */
function boardLabel(boardId: string): string {
  return fileName(boardId).replace(/\.excalidraw$/i, "") || "Board";
}

/** Narrow title accessor — an O(1) view over the note index, never a copy. */
type TitleLookup = { get: (id: string) => string | undefined };

function tabLabel(tab: Tab, titles: TitleLookup, chatTitles: ReadonlyMap<string, string>): string {
  // surfaceKind dispatch — grows with the union ('chat' …)
  switch (tab.surfaceKind) {
    case "note":
      return titles.get(tab.noteId) ?? "Untitled";
    case "canvas":
      return boardLabel(tab.boardId);
    case "chat":
      return tab.chatSlug ? (chatTitles.get(tab.chatSlug) ?? tab.chatSlug.replace(/-/g, " ")) : "New chat";
    case "file":
      return fileName(tab.fileId);
    case "activity":
      return "Librarian Activity";
    case "newItem":
      return tab.pendingLabel ?? "New…";
    case "browser":
      return privateBrowserTabTitle(tab.id);
  }
}

export function TabStrip({ pane }: { pane: LeafNode }) {
  useSyncExternalStore(
    subscribePrivateBrowserTitles,
    privateBrowserTitleSnapshot,
    privateBrowserTitleSnapshot,
  );
  const newTabDefault = useUiStore((s) => s.newTabDefault);
  const tabLayout = useUiStore((s) => s.tabLayout);
  const activateTab = usePanesStore((s) => s.activateTab);
  const draggingTab = usePanesStore((s) => s.draggingTab);
  // Main lives here too — a tab is a note (or board) you're looking at, so
  // right-click → Add to Main mirrors the note-row menu (the maintainer, 2026-07-07).
  const mainManifest = useMainStore((s) => s.manifest);
  const setMainTree = useMainStore((s) => s.setTree);
  // double-click a board tab to rename it in place (shares the sidebar's flow)
  const {
    renamingBoardId,
    start: startRename,
    commit: commitRename,
    cancel: cancelRename,
  } = useBoardRename();
  // double-click / right-click a chat tab to rename it (renames chats/<slug>.md)
  const {
    renamingChatSlug,
    start: startChatRename,
    commit: commitChatRename,
    cancel: cancelChatRename,
  } = useChatRename();
  // the insertion index previewed for THIS strip (2px line), or null
  const dropAt = usePanesStore((s) =>
    s.dropPreview?.kind === "strip" && s.dropPreview.paneId === pane.id ? s.dropPreview.index : null,
  );
  // the FULL note index — a tab can hold a STAGED note (wiki/_inbox → the
  // hidden "Board" root) or an archived/trashed one; useNotes() alone read
  // those tabs as "Untitled".
  const noteIndex = useNoteIndex();
  // Direct O(1) lookups per tab — the old per-render Map copy of EVERY note's
  // title was O(all-notes) × per pane strip × per invalidation (perf audit
  // 2026-07-30, finding 11).
  const titles = useMemo<TitleLookup>(() => ({ get: (id) => noteIndex.get(id)?.title }), [noteIndex]);
  const memexConfig = useMemexConfig();
  const activeMemex = memexConfig.data ? activeInstance(memexConfig.data) : null;
  const chats = useInstanceChats(activeMemex);
  const chatTitles = useMemo(
    () => new Map((chats.data ?? []).map((chat) => [chat.slug, chat.title])),
    [chats.data],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const browserActive = activeTabOf(pane)?.surfaceKind === "browser";
  const newTabLabel = browserActive
    ? "New private browser tab"
    : `New ${newItemDefinition(newTabDefault).label} tab`;
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFade]);

  // tab count changes resize content, not the container — re-check explicitly
  useEffect(updateFade, [pane.tabs.length, updateFade]);

  // keep the active tab visible when it changes (new tab, ⌘1–9, ⌃Tab)
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
    updateFade();
  }, [pane.activeTabId, updateFade]);

  const newTabHere = () => {
    // focus this pane first so the fresh note tab opens HERE, then create a new
    // blank note (not a duplicate — the maintainer #8, 2026-07-03).
    usePanesStore.getState().focusPane(pane.id);
    newItemInTab();
  };

  // right-click a tab → the shared context-menu host (the maintainer, 2026-07-01: rename a
  // board "via the tab or left menu"). Rename covers boards (inline strip input)
  // and notes (the title-line dialog); close/close-others round it out.
  const openTabMenu = (event: MouseEvent, tab: Tab) => {
    event.preventDefault();
    event.stopPropagation();
    const items: MenuSpec[] = [];
    // Add/Remove from Main — for the tabs that hold a real note or board id.
    const mainId =
      tab.surfaceKind === "note" ? tab.noteId : tab.surfaceKind === "canvas" ? tab.boardId : null;
    if (mainId) {
      const inMain = mainHasNote(mainManifest.tree, mainId);
      items.push({
        kind: "action",
        label: inMain ? "Remove from Main" : "Add to Main",
        onClick: () =>
          setMainTree(
            inMain ? removeFromMain(mainManifest.tree, mainId) : addNoteToMain(mainManifest.tree, mainId),
            new Set(noteIndex.keys()),
          ),
      });
      items.push({ kind: "sep" });
    }
    if (tab.surfaceKind === "canvas") {
      items.push({ kind: "action", label: "Rename…", onClick: () => startRename(tab.boardId) });
      items.push({ kind: "sep" });
    } else if (tab.surfaceKind === "note") {
      items.push({
        kind: "action",
        label: "Rename…",
        onClick: () =>
          useUiStore.getState().setRenameTarget({ id: tab.noteId, current: titles.get(tab.noteId) ?? "" }),
      });
      items.push({ kind: "sep" });
    } else if (tab.surfaceKind === "file" && renameLane({ id: tab.fileId, kind: "file" }) === "file") {
      const fileId = tab.fileId;
      items.push({
        kind: "action",
        label: "Rename…",
        onClick: () =>
          useUiStore.getState().setRenameTarget({ id: fileId, current: fileNameStem(fileId), lane: "file" }),
      });
      items.push({ kind: "sep" });
    } else if (tab.surfaceKind === "chat" && tab.chatSlug) {
      const slug = tab.chatSlug;
      items.push({ kind: "action", label: "Rename…", onClick: () => startChatRename(slug) });
      items.push({ kind: "sep" });
    }
    items.push({
      kind: "action",
      label: "Close tab",
      onClick: () => closeTabWithDraftCleanup(pane.id, tab.id),
    });
    items.push({
      kind: "action",
      label: "Close other tabs",
      disabled: pane.tabs.length <= 1,
      onClick: () => closeOtherTabsWithDraftCleanup(pane.id, tab.id),
    });
    items.push({
      kind: "action",
      label: "Close tabs to the right",
      disabled: pane.tabs[pane.tabs.length - 1]?.id === tab.id,
      onClick: () => closeTabsRightWithDraftCleanup(pane.id, tab.id),
    });
    items.push({ kind: "sep" });
    // detachTab was fully built but findable only by accidentally dragging a
    // tab onto a pane edge — give it menu words (slice 4, 2026-07-28)
    items.push({
      kind: "action",
      label: "Split right with this tab",
      disabled: pane.tabs.length < 2,
      onClick: () => usePanesStore.getState().detachTab(pane.id, tab.id, pane.id, "right"),
    });
    items.push({
      kind: "action",
      label: "Split down with this tab",
      disabled: pane.tabs.length < 2,
      onClick: () => usePanesStore.getState().detachTab(pane.id, tab.id, pane.id, "down"),
    });
    useContextMenu.getState().open(event.clientX, event.clientY, items);
  };

  return (
    <div className="tabstrip" data-tab-layout={tabLayout} role="tablist">
      <div className="tabscroll-wrap" data-fade-left={fade.left} data-fade-right={fade.right}>
        <div
          className="tabscroll"
          data-tabscroll
          data-pane-id={pane.id}
          ref={scrollRef}
          onScroll={updateFade}
        >
          {pane.tabs.map((tab, i) => {
            const dragging = draggingTab?.paneId === pane.id && draggingTab.tabId === tab.id;
            const label = tabLabel(tab, titles, chatTitles);
            return (
              <div key={tab.id} className={tab.id === pane.activeTabId ? "tabslot active" : "tabslot"}>
                {dropAt === i && <span className="tab-ins" aria-hidden="true" />}
                <div
                  role="tab"
                  data-tab-id={tab.id}
                  data-tab-index={i}
                  data-hotkey={tabHotkeyAction(i, pane.tabs.length)}
                  title={label}
                  aria-selected={tab.id === pane.activeTabId}
                  className={`${tab.id === pane.activeTabId ? "tab active" : "tab"}${
                    tab.preview ? " preview" : ""
                  }${dragging ? " dragging" : ""}`}
                  onClick={() => activateTab(pane.id, tab.id)}
                  onContextMenu={(event) => openTabMenu(event, tab)}
                  onAuxClick={(event) => {
                    // middle-click closes — the twin of the note rows' middle-
                    // click-opens grammar (#81, audit 2026-07)
                    if (event.button === 1) {
                      event.preventDefault();
                      closeTabWithDraftCleanup(pane.id, tab.id);
                    }
                  }}
                  onPointerDown={(event) => startTabDrag(event, pane.id, tab.id, label)}
                >
                  {tab.surfaceKind === "canvas" ? (
                    <ExcalidrawGlyph size={13} className="tglyph" />
                  ) : tab.surfaceKind === "chat" ? (
                    <ChatGlyph size={13} className="tglyph" />
                  ) : tab.surfaceKind === "file" ? (
                    glyphForNote(
                      { kind: "file", title: fileName(tab.fileId) },
                      { size: 13, className: "tglyph" },
                    )
                  ) : tab.surfaceKind === "activity" ? (
                    <ClockGlyph size={13} className="tglyph" />
                  ) : tab.surfaceKind === "browser" ? (
                    <BrowserGlyph size={13} className="tglyph" />
                  ) : (
                    <FileGlyph size={13} className="tglyph" />
                  )}
                  {tab.surfaceKind === "canvas" && renamingBoardId === tab.boardId ? (
                    <InlineRenameInput
                      className="tab-rename"
                      defaultValue={tabLabel(tab, titles, chatTitles)}
                      ariaLabel="Rename board"
                      onCommit={(value) => commitRename(tab.boardId, value)}
                      onCancel={cancelRename}
                    />
                  ) : tab.surfaceKind === "chat" && !!tab.chatSlug && renamingChatSlug === tab.chatSlug ? (
                    <InlineRenameInput
                      className="tab-rename"
                      defaultValue={tabLabel(tab, titles, chatTitles)}
                      ariaLabel="Rename chat"
                      onCommit={(value) => commitChatRename(tab.chatSlug ?? "", value)}
                      onCancel={cancelChatRename}
                    />
                  ) : (
                    <span
                      className="tab-label"
                      onDoubleClick={
                        tab.surfaceKind === "canvas"
                          ? () => startRename(tab.boardId)
                          : tab.surfaceKind === "chat" && tab.chatSlug
                            ? () => startChatRename(tab.chatSlug ?? "")
                            : undefined
                      }
                    >
                      <span className="tab-title">{label}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    className="x"
                    aria-label={`Close tab${hotkeyHint(" — ⌘W")}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTabWithDraftCleanup(pane.id, tab.id);
                    }}
                  >
                    <XGlyph size={9} />
                  </button>
                </div>
                {dropAt === pane.tabs.length && i === pane.tabs.length - 1 && (
                  <span className="tab-ins" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="tabplus"
        aria-label={`${newTabLabel}${hotkeyHint(" — ⌘T")}`}
        onClick={newTabHere}
      >
        <PlusGlyph size={13} />
        <span className="tip" aria-hidden="true">
          {newTabLabel} — ⌘T
        </span>
      </button>
    </div>
  );
}
