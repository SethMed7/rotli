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
import { createRoutedNote } from "../services/createNote";
import { invalidateNotes } from "../services/hooks";
import { inboxFolderId, notesService } from "../services/notes";
import { invalidateMemex } from "../memex/useMemex";
import { captureHandle } from "../lib/captureHandle";
import { quickHandle } from "../lib/quickHandle";
import {
  hideMainWindow,
  hideQuickWindow,
  summon,
  toggleMainWindow,
  toggleQuickWindow,
} from "../lib/tauri";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { cycleQuick, removeQuickNote } from "../state/quick";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
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
 * shelf folder seeds the note's shelf; an explicit local folder is always respected. */
async function newNote(): Promise<void> {
  const { selectedFolderId } = useUiStore.getState();
  const isSmart = selectedFolderId === ALL_NOTES || selectedFolderId === RECENT;
  const id = await createRoutedNote({
    selectedFolderId,
    isSmart,
    localFallback: inboxFolderId,
    body: "",
  });
  await invalidateNotes();
  await invalidateMemex(); // the memex-derived listing refreshes too
  usePanesStore.getState().openNote(id);
}

export function registerDefaultActions(): void {
  registerAction({
    id: "app.hide",
    title: "Hide rotli",
    defaultChord: "Esc",
    run: () => {
      // Esc unwinds one layer at a time (quokka rule): topmost transient
      // (popovers incl. the module switcher, in stack order) → settings →
      // board → chat → memory → focus mode → the window itself.
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
      if (ui.chatOpen) {
        ui.setChatOpen(false);
        return;
      }
      if (ui.memoryOpen) {
        ui.setMemoryOpen(false);
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
      ui.setSwitcherOpen(false);
      ui.setFocusMode(!ui.focusMode);
    },
  });
  registerAction({
    id: "app.settings",
    title: "Settings",
    defaultChord: "Meta+Comma",
    run: () => {
      const ui = useUiStore.getState();
      ui.setFocusMode(false);
      ui.setSwitcherOpen(false);
      ui.setContentView("panes");
      ui.setSettingsOpen(!ui.settingsOpen);
    },
  });

  // The Board — quick captures collected as cards (Seth, 2026-06-19). A view in
  // the content area now (the sidebar stays); ⌘K-reachable + rebindable, opened
  // from the sidebar. Toggles between the board grid and the note panes.
  registerAction({
    id: "board.open",
    title: "Board — captures",
    defaultChord: null,
    run: () => {
      const ui = useUiStore.getState();
      ui.setFocusMode(false);
      ui.setSwitcherOpen(false);
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
      if (id) void notesService.archiveNote(id).then(invalidateNotes);
    },
  });
  registerAction({
    id: "notes.trash",
    title: "Move note to Trash",
    defaultChord: null,
    run: () => {
      const id = focusedNoteIdNow();
      if (id) void notesService.trashNote(id).then(invalidateNotes);
    },
  });
  registerAction({
    id: "notes.restore",
    title: "Restore note",
    defaultChord: null,
    run: () => {
      const id = focusedNoteIdNow();
      if (id) void notesService.restoreNote(id).then(invalidateNotes);
    },
  });

  // — tabs (created only by explicit gestures; plain click replaces) —
  registerAction({
    id: "tabs.new",
    title: "New tab",
    defaultChord: "Meta+T",
    run: () => usePanesStore.getState().newTab(),
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
    run: () => useUiStore.getState().setSwitcherOpen(false), // already the current module
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
