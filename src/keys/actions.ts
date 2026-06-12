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
import { invalidateNotes } from "../services/hooks";
import { inboxFolder, notesService } from "../services/notes";
import { captureHandle } from "../lib/captureHandle";
import { hideMainWindow, summon, toggleMainWindow } from "../lib/tauri";
import { usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import { registerAction } from "./registry";

/** ⌘N: create in the selected folder (Inbox when a smart row is selected),
 * then open it replacing the focused pane's active tab. */
async function newNote(): Promise<void> {
  const { selectedFolderId } = useUiStore.getState();
  const folderId =
    selectedFolderId === ALL_NOTES || selectedFolderId === RECENT
      ? inboxFolder.id
      : selectedFolderId;
  const note = await notesService.createNote(folderId, "");
  await invalidateNotes();
  usePanesStore.getState().openNote(note.id);
}

export function registerDefaultActions(): void {
  registerAction({
    id: "app.hide",
    title: "Hide rotli",
    defaultChord: "Esc",
    run: () => {
      // Esc unwinds one layer at a time (quokka rule): topmost transient
      // (popovers incl. the module switcher, in stack order) → settings →
      // focus mode → the window itself.
      const ui = useUiStore.getState();
      if (ui.closeTopTransient()) return;
      if (ui.settingsOpen) {
        ui.setSettingsOpen(false);
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
      ui.setSettingsOpen(!ui.settingsOpen);
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
  registerAction({
    id: "chrome.toggleFolders",
    title: "Toggle folders rail",
    defaultChord: "Meta+0",
    run: () => useUiStore.getState().toggleFolders(),
  });
  registerAction({
    id: "chrome.toggleList",
    title: "Toggle note list",
    defaultChord: "Alt+Meta+L",
    run: () => useUiStore.getState().toggleList(),
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
    registerAction({ id, title, defaultChord, run: () => activeEditor()?.toggleMark(mark) });
  }
  for (const level of [1, 2, 3] as HeadingLevel[]) {
    registerAction({
      id: `editor.heading${level}`,
      title: `Heading ${level}`,
      defaultChord: null,
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
}
