// Every user-invocable action registers here so ⌘K and Settings → Hotkeys can
// list and rebind all of it. One dispatcher per webview, no ad-hoc keydown
// listeners anywhere else. Both webviews register the full set — the
// dispatcher only fires the actions for its own surface, and the Settings
// list shows everything.

import {
  type BlockToggle,
  type HeadingLevel,
  type InlineMark,
  activeEditor,
} from "../editor/commands";
import { summonChat } from "../services/chatSummon";
import { createRoutedNote } from "../services/createNote";
import { invalidateNotes, lifecycleError } from "../services/hooks";
import { inboxFolderId, notesService } from "../services/notes";
import { invalidateMemex } from "../memex/useMemex";
import { captureHandle } from "../lib/captureHandle";
import { quickHandle } from "../lib/quickHandle";
import {
  corpusCreateBoard,
  corpusFrontmatter,
  corpusSetPinned,
  hideMainWindow,
  hideQuickWindow,
  summon,
  toggleMainWindow,
  toggleQuickWindow,
} from "../lib/tauri";
import { DEFAULT_NOTE_STYLE, useNoteStyleStore } from "../state/noteStyle";
import { useMainStore } from "../state/main";
import { MAIN_ROOT, addNoteToMainAt, mainFolderIds, mainParentOfNote } from "../services/mainTree";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { cycleQuick, removeQuickNote } from "../state/quick";
import { ALL_NOTES, RECENT, SIDEBAR_ZOOM_STEP, useUiStore } from "../state/ui";
import { registerAction } from "./registry";

/** The focused pane's active tab noteId, read imperatively for action runs
 * (the hook form useFocusedNoteId is for components). null when the pane has no
 * resolvable tab (Seth, 2026-06-13: the lifecycle chords target this note). */
function focusedNoteIdNow(): string | null {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  if (!leaf) return null;
  const tab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
  return tab && tab.surfaceKind === "note" ? tab.noteId : null;
}

/** ⌘N / "+ New note": create where the memex-is-the-home model dictates — INTO the
 * connected memex's wiki/_inbox staging (v3.5) when a writable memex is active and no
 * explicit LOCAL folder is selected, else the local Inbox — then open it. A selected
 * shelf folder seeds the note's shelf; an explicit local folder is always respected —
 * except the hidden roots (Archive/Trash/Board), which routeDecision diverts to the
 * fallback so ⌘N can never birth a note inside a sink (#5, audit 2026-07). */
async function newNote(opts?: { newTab?: boolean }): Promise<void> {
  const { selectedFolderId } = useUiStore.getState();
  // A Main folder ("main:<path>") is a VIEW, not a disk folder — never route
  // physical creation into it (routeDecision would treat it as a real local
  // folder and try to write to a path that doesn't exist). Route like a smart
  // row, but remember the Main folder as the slot the new note lands in.
  const inMainFolder = selectedFolderId.startsWith(MAIN_ROOT) && selectedFolderId !== MAIN_ROOT;
  const routeFolderId = inMainFolder ? ALL_NOTES : selectedFolderId;
  const isSmart = routeFolderId === ALL_NOTES || routeFolderId === RECENT;
  const id = await createRoutedNote({
    selectedFolderId: routeFolderId,
    isSmart,
    localFallback: inboxFolderId,
    body: "",
  });
  await invalidateNotes();
  await invalidateMemex(); // the memex-derived listing refreshes too
  fileNewNoteIntoMain(id, inMainFolder ? selectedFolderId : null);
  usePanesStore.getState().openNote(id, opts);
}

/** #15/#16 (Seth, 2026-07-03): every new note lands in Main, inside the folder
 * the user is working in — an explicitly selected Main folder, else the Main
 * folder of the currently-active note — else at the Main root. Main references
 * notes by id, so this is a pure manifest add (the physical file is untouched). */
function fileNewNoteIntoMain(noteId: string, selectedMainFolder: string | null): void {
  const { manifest, setTree } = useMainStore.getState();
  let parent = MAIN_ROOT;
  if (selectedMainFolder && mainFolderIds(manifest.tree).includes(selectedMainFolder)) {
    parent = selectedMainFolder;
  } else {
    const active = focusedNoteIdNow();
    const viaNote = active ? mainParentOfNote(manifest.tree, active) : null;
    if (viaNote) parent = viaNote;
  }
  setTree(addNoteToMainAt(manifest.tree, noteId, parent));
}

/** ⌘T / the tab-strip "+": open a NEW blank note in a new tab — not a duplicate
 * of the current tab (Seth #8, 2026-07-03) — filed into Main like any new note,
 * inheriting the current note's Main folder (#16). */
export function newNoteInTab(): void {
  void newNote({ newTab: true });
}

/** ⌘+/⌘− — CONTEXTUAL zoom (Seth, 2026-06-26: "zoom in and out but just where I
 * am"): with focus in the sidebar it scales the sidebar tree; otherwise it steps
 * the FOCUSED note's body text size (the per-note Aa render layer — persisted to
 * settings, never written into the .md). Other surfaces (chat/canvas/file) are
 * untouched for now. */
function zoomBy(delta: 1 | -1): void {
  if (document.activeElement?.closest(".sidebar")) {
    const ui = useUiStore.getState();
    ui.setSidebarZoom(ui.sidebarZoom + delta * SIDEBAR_ZOOM_STEP);
    return;
  }
  const noteId = focusedNoteIdNow();
  if (!noteId) return;
  const styles = useNoteStyleStore.getState();
  const size = styles.styles[noteId]?.size ?? DEFAULT_NOTE_STYLE.size;
  styles.setSize(noteId, size + delta); // setSize clamps to the readable band
}

function zoomReset(): void {
  if (document.activeElement?.closest(".sidebar")) {
    useUiStore.getState().setSidebarZoom(1);
    return;
  }
  const noteId = focusedNoteIdNow();
  if (noteId) useNoteStyleStore.getState().setSize(noteId, DEFAULT_NOTE_STYLE.size);
}

/** ⌘⇧N / "+ New board": create an Excalidraw board in the local Inbox, open it,
 * and drop its sidebar row into rename mode so you name it first. Boards are
 * local (the memex is read-mostly), so this never routes into the Vault. */
async function newBoard(): Promise<void> {
  const meta = await corpusCreateBoard(inboxFolderId);
  await invalidateNotes();
  usePanesStore.getState().openCanvas(meta.id);
  useUiStore.getState().setRenamingBoardId(meta.id);
}

export function registerDefaultActions(): void {
  registerAction({
    id: "app.hide",
    title: "Hide rotli",
    defaultChord: "Esc",
    run: () => {
      // Esc unwinds one layer at a time (quokka rule): topmost transient
      // (popovers, in stack order) → settings → a content view (board / all-notes
      // / chat) back to the note panes → memory → focus mode → the window itself.
      const ui = useUiStore.getState();
      if (ui.closeTopTransient()) return;
      if (ui.settingsOpen) {
        ui.setSettingsOpen(false);
        return;
      }
      if (ui.contentView !== "panes") {
        ui.setContentView("panes");
        return;
      }
      if (ui.focusMode) {
        ui.setFocusMode(false);
        return;
      }
      void hideMainWindow();
    },
  });

  // — the two summon surfaces (both global, separately rebindable).
  // Seth's law (2026-06-12): ⌥Space opens the APP; capture has its own chord. —
  registerAction({
    id: "app.toggleWindow",
    title: "Open or hide rotli",
    defaultChord: "Alt+Space",
    global: true,
    run: () => void toggleMainWindow(),
  });
  registerAction({
    id: "capture.summon",
    title: "Quick capture",
    defaultChord: "Alt+C",
    global: true, // lives in Rust; dispatch() works for review automation
    run: () => void summon(),
  });
  registerAction({
    id: "quick.summon",
    title: "Quick note",
    defaultChord: "Alt+Q",
    global: true, // the floating Quick Note window; toggle lives in Rust
    run: () => void toggleQuickWindow(),
  });

  // — the command layer —
  registerAction({
    id: "palette.toggle",
    title: "Search notes & actions",
    defaultChord: "Meta+K",
    run: () => {
      const ui = useUiStore.getState();
      ui.setPaletteOpen(!ui.paletteOpen);
    },
  });
  registerAction({
    id: "view.focus",
    title: "Focus mode",
    defaultChord: "Alt+Meta+F",
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setFocusMode(!ui.focusMode);
    },
  });
  // Block handles — the Milkdown-style ⠿ drag/add/remove gutter (also an Aa toggle).
  registerAction({
    id: "editor.toggleBlocks",
    title: "Toggle block handles",
    defaultChord: null,
    run: () => {
      const ui = useUiStore.getState();
      ui.setBlockHandles(!ui.blockHandles);
    },
  });
  registerAction({
    id: "app.settings",
    title: "Settings",
    defaultChord: "Meta+Comma",
    run: () => {
      const ui = useUiStore.getState();
      ui.setFocusMode(false);
      ui.setContentView("panes");
      ui.setSettingsOpen(!ui.settingsOpen);
    },
  });

  // The Board — quick captures collected as cards (Seth, 2026-06-19). A view in
  // the content area now (the sidebar stays); ⌘K-reachable + rebindable, opened
  // from the sidebar. Toggles between the board grid and the note panes.
  registerAction({
    id: "board.open",
    title: "Captures",
    defaultChord: null,
    run: () => {
      const ui = useUiStore.getState();
      ui.setFocusMode(false);
      ui.setSettingsOpen(false);
      ui.setContentView(ui.contentView === "board" ? "panes" : "board");
    },
  });

  registerAction({
    id: "theme.cycle",
    title: "Cycle theme",
    defaultChord: null,
    run: () => useUiStore.getState().cycleTheme(),
  });

  registerAction({
    id: "theme.cycleGlassTint",
    title: "Cycle glass tint",
    defaultChord: null,
    run: () => useUiStore.getState().cycleGlassTint(),
  });

  // — notes —
  registerAction({
    id: "notes.new",
    title: "New note",
    defaultChord: "Meta+N",
    run: () => void newNote(),
  });
  registerAction({
    id: "boards.new",
    title: "New Excalidraw board",
    defaultChord: "Meta+Shift+N",
    run: () =>
      void newBoard().catch((e) =>
        useUiStore
          .getState()
          .setRowActionError(
            `Couldn’t create a board — ${e instanceof Error ? e.message : String(e)}`,
          ),
      ),
  });

  // — note lifecycle (Seth, 2026-06-13): archive / trash / restore the FOCUSED
  //   note (the focused pane's active tab). All three reach ⌘K automatically and
  //   are rebindable. Trash is deliberately UNBOUND by default: ⌘⌫ would hijack
  //   the editor's delete-to-line-start AND get preventDefault-ed, so it ships
  //   chord-less but still palette-reachable. —
  registerAction({
    id: "notes.archive",
    title: "Archive note",
    defaultChord: "Meta+Shift+A",
    run: () => {
      const id = focusedNoteIdNow();
      if (id) void notesService.archiveNote(id).then(invalidateNotes).catch(lifecycleError("archive"));
    },
  });
  registerAction({
    id: "notes.trash",
    title: "Move note to Trash",
    defaultChord: null,
    run: () => {
      const id = focusedNoteIdNow();
      if (id) void notesService.trashNote(id).then(invalidateNotes).catch(lifecycleError("delete"));
    },
  });
  registerAction({
    id: "notes.restore",
    title: "Restore note",
    defaultChord: null,
    run: () => {
      const id = focusedNoteIdNow();
      if (id) void notesService.restoreNote(id).then(invalidateNotes).catch(lifecycleError("restore"));
    },
  });
  // Pin / unpin the FOCUSED note (Seth, 2026-07-06: "a hotkey for pinning the
  // note I am already on"). Reads the note's current pin state, then flips the
  // typed `pinned` frontmatter fact — pinned notes float to the top of every
  // list. Never bumps `updated`, so a pin doesn't reorder by recency.
  registerAction({
    id: "notes.pin",
    title: "Pin / unpin note to top",
    defaultChord: "Meta+Shift+P",
    run: () => {
      const id = focusedNoteIdNow();
      if (!id) return;
      void corpusFrontmatter(id).then((fm) =>
        corpusSetPinned(id, !fm?.pinned).then(invalidateNotes),
      );
    },
  });

  // — tabs (created only by explicit gestures; plain click replaces). ⌘T opens
  //   a fresh blank note in a new tab (Seth #8: "new tab AND note, not a
  //   duplicate of where you already are"), filed into the current Main folder. —
  registerAction({
    id: "tabs.new",
    title: "New tab",
    defaultChord: "Meta+T",
    run: () => newNoteInTab(),
  });
  registerAction({
    id: "tabs.close",
    title: "Close tab",
    defaultChord: "Meta+W",
    run: () => usePanesStore.getState().closeTab(),
  });
  registerAction({
    id: "tabs.cycle",
    title: "Next tab",
    defaultChord: "Ctrl+Tab",
    run: () => usePanesStore.getState().cycleTab(),
  });
  for (let n = 1; n <= 8; n++) {
    registerAction({
      id: `tabs.jump${n}`,
      title: `Go to tab ${n}`,
      defaultChord: `Meta+${n}`,
      run: () => usePanesStore.getState().jumpTab(n - 1),
    });
  }
  registerAction({
    id: "tabs.last",
    title: "Go to last tab",
    defaultChord: "Meta+9",
    run: () => usePanesStore.getState().lastTab(),
  });

  // — panes —
  registerAction({
    id: "panes.splitRight",
    title: "Split right",
    defaultChord: "Meta+D",
    run: () => usePanesStore.getState().splitRight(),
  });
  registerAction({
    id: "panes.splitDown",
    title: "Split down",
    defaultChord: "Meta+Shift+D",
    run: () => usePanesStore.getState().splitDown(),
  });
  registerAction({
    id: "panes.focusLeft",
    title: "Focus pane left",
    defaultChord: "Meta+Alt+ArrowLeft",
    run: () => usePanesStore.getState().focusDir("left"),
  });
  registerAction({
    id: "panes.focusRight",
    title: "Focus pane right",
    defaultChord: "Meta+Alt+ArrowRight",
    run: () => usePanesStore.getState().focusDir("right"),
  });
  registerAction({
    id: "panes.focusUp",
    title: "Focus pane up",
    defaultChord: "Meta+Alt+ArrowUp",
    run: () => usePanesStore.getState().focusDir("up"),
  });
  registerAction({
    id: "panes.focusDown",
    title: "Focus pane down",
    defaultChord: "Meta+Alt+ArrowDown",
    run: () => usePanesStore.getState().focusDir("down"),
  });
  registerAction({
    id: "panes.close",
    title: "Close pane",
    defaultChord: "Meta+Alt+W",
    run: () => usePanesStore.getState().closePane(),
  });

  // — chrome —
  // ONE sidebar toggle (Seth, 2026-06-13: folders + note-list collapsed into a
  // single navigator; chrome.toggleList ⌥⌘L retired). ⌘0 keeps its muscle
  // memory; the inline .sidebtn and the warm-edge restore strip dispatch this
  // same action — one row in Settings, not two.
  registerAction({
    id: "chrome.toggleSidebars",
    title: "Toggle sidebar",
    defaultChord: "Meta+0",
    run: () => useUiStore.getState().toggleSidebar(),
  });

  // — contextual zoom (Seth, 2026-06-26): ⌘+/⌘− act where the focus is — the
  // sidebar tree, or the focused note's text size. Reset is palette-reachable.
  registerAction({
    id: "view.zoomIn",
    title: "Zoom in — sidebar or note",
    defaultChord: "Meta+Equal",
    run: () => zoomBy(1),
  });
  registerAction({
    id: "view.zoomOut",
    title: "Zoom out — sidebar or note",
    defaultChord: "Meta+Minus",
    run: () => zoomBy(-1),
  });
  registerAction({
    id: "view.zoomReset",
    title: "Reset zoom",
    defaultChord: null,
    run: () => zoomReset(),
  });

  // — editor formatting (the r5 format bar's 11 controls + highlight; chords
  //   from the r3 gate footer, the rest unbound-but-rebindable) —
  const marks: [string, string, InlineMark, string | null][] = [
    ["editor.bold", "Bold", "bold", "Meta+B"],
    ["editor.italic", "Italic", "italic", "Meta+I"],
    ["editor.underline", "Underline", "underline", "Meta+U"],
    ["editor.strike", "Strikethrough", "strike", null],
    ["editor.code", "Inline code", "code", null],
    ["editor.highlight", "Highlight", "highlight", "Meta+Shift+H"],
    ["editor.link", "Link", "link", null],
  ];
  for (const [id, title, mark, defaultChord] of marks) {
    // shared: the format chords act on activeEditor(), which resolves per
    // webview — so they belong to the main AND the Quick Note window
    registerAction({ id, title, defaultChord, shared: true, run: () => activeEditor()?.toggleMark(mark) });
  }
  for (const level of [1, 2, 3] as HeadingLevel[]) {
    registerAction({
      id: `editor.heading${level}`,
      title: `Heading ${level}`,
      defaultChord: null,
      shared: true,
      run: () => activeEditor()?.setHeading(level),
    });
  }
  const blocks: [string, string, BlockToggle][] = [
    ["editor.quote", "Quote", "quote"],
    ["editor.bulletList", "Bulleted list", "bullet"],
    ["editor.numberedList", "Numbered list", "numbered"],
    ["editor.checklist", "Checklist", "checklist"],
  ];
  for (const [id, title, kind] of blocks) {
    registerAction({
      id,
      title,
      defaultChord: null,
      shared: true,
      run: () => activeEditor()?.toggleBlock(kind),
    });
  }

  registerAction({
    id: "modules.notes",
    title: "Go to Notes",
    defaultChord: "Ctrl+1",
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setContentView("panes"); // back to the note panes
    },
  });

  // Chat is the middle left-menu section (no longer a dropdown module). The
  // palette/⌃2 opens a fresh chat in the content area; the sidebar drives chat
  // selection directly. Both reach ⌘K and are rebindable.
  registerAction({
    id: "chat.new",
    title: "New chat",
    defaultChord: "Ctrl+2",
    run: () => {
      useUiStore.getState().setSettingsOpen(false);
      // chat is a PANE surface now — open a fresh chat pane. The old contentView
      // "chat" was retired and rendered nothing (Seth, 2026-06-30 — audit).
      usePanesStore.getState().openChat(null);
    },
  });
  registerAction({
    id: "chat.summon",
    title: "Summon chat",
    defaultChord: "Alt+A", // "ask" — the ⌥-letter global family (⌥Space/⌥C/⌥Q)
    global: true, // the OS chord lives in Rust (show_main + rotli:summon-chat);
    // run() keeps palette/dispatch parity for in-app invocation
    run: () => void summonChat(),
  });
  registerAction({
    id: "chat.all",
    title: "All chats",
    defaultChord: null,
    run: () => {
      useUiStore.getState().setSettingsOpen(false);
      // open the All-chats content view (the Chat-front twin of All notes)
      useUiStore.getState().setContentView("allChats");
    },
  });

  // — the capture card's own keys (surface: capture — its webview's dispatcher
  //   routes these; the textarea never grows ad-hoc listeners) —
  registerAction({
    id: "capture.save",
    title: "Capture — save",
    defaultChord: "Enter",
    surface: "capture",
    run: () => captureHandle()?.save(false),
  });
  registerAction({
    id: "capture.saveAndOpen",
    title: "Capture — save & open",
    defaultChord: "Meta+Enter",
    surface: "capture",
    run: () => captureHandle()?.save(true),
  });
  registerAction({
    id: "capture.dismiss",
    title: "Capture — dismiss",
    defaultChord: "Esc",
    surface: "capture",
    run: () => captureHandle()?.dismiss(),
  });

  // — the Quick Note window's own keys (surface: quick). new/search reach the
  //   mounted component through quickHandle; cycle/remove act on the set store;
  //   dismiss unwinds a transient (the search overlay) before hiding the window. —
  registerAction({
    id: "quick.new",
    title: "Quick note — new",
    defaultChord: "Meta+N",
    surface: "quick",
    run: () => quickHandle()?.newNote(),
  });
  registerAction({
    id: "quick.search",
    title: "Quick note — switch / pin notes",
    defaultChord: "Meta+P",
    surface: "quick",
    run: () => quickHandle()?.openSearch(),
  });
  registerAction({
    id: "quick.next",
    title: "Quick note — next",
    defaultChord: "Meta+BracketRight",
    surface: "quick",
    run: () => cycleQuick(1),
  });
  registerAction({
    id: "quick.prev",
    title: "Quick note — previous",
    defaultChord: "Meta+BracketLeft",
    surface: "quick",
    run: () => cycleQuick(-1),
  });
  registerAction({
    id: "quick.remove",
    title: "Quick note — remove from set",
    defaultChord: null,
    surface: "quick",
    run: () => {
      const id = useUiStore.getState().quickActiveId;
      if (id) removeQuickNote(id);
    },
  });
  registerAction({
    id: "quick.dismiss",
    title: "Quick note — dismiss",
    defaultChord: "Esc",
    surface: "quick",
    run: () => {
      // unwind a transient (the search overlay / a popover) before the window
      if (useUiStore.getState().closeTopTransient()) return;
      void hideQuickWindow();
    },
  });
}
