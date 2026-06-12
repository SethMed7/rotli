// Every user-invocable action registers here so ⌘K and Settings → Hotkeys
// (later phases) can list and rebind all of it. One dispatcher, no ad-hoc
// keydown listeners anywhere else.

import { invalidateNotes } from "../services/hooks";
import { inboxFolder, notesService } from "../services/notes";
import { hideMainWindow, toggleMainWindow } from "../lib/tauri";
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
    chord: "Esc",
    run: () => {
      // Esc closes the topmost transient first (quokka rule), then the window.
      const { switcherOpen, setSwitcherOpen } = useUiStore.getState();
      if (switcherOpen) {
        setSwitcherOpen(false);
        return;
      }
      void hideMainWindow();
    },
  });

  registerAction({
    id: "app.toggleWindow",
    title: "Summon rotli",
    chord: "Alt+Space",
    global: true, // registered + handled in Rust; dispatch() still works for review automation
    run: () => void toggleMainWindow(),
  });

  registerAction({
    id: "theme.cycle",
    title: "Cycle theme",
    chord: null,
    run: () => useUiStore.getState().cycleTheme(),
  });

  // — notes —
  registerAction({
    id: "notes.new",
    title: "New note",
    chord: "Meta+N",
    run: () => void newNote(),
  });

  // — tabs (created only by explicit gestures; plain click replaces) —
  registerAction({
    id: "tabs.new",
    title: "New tab",
    chord: "Meta+T",
    run: () => usePanesStore.getState().newTab(),
  });
  registerAction({
    id: "tabs.close",
    title: "Close tab",
    chord: "Meta+W",
    run: () => usePanesStore.getState().closeTab(),
  });
  registerAction({
    id: "tabs.cycle",
    title: "Next tab",
    chord: "Ctrl+Tab",
    run: () => usePanesStore.getState().cycleTab(),
  });
  for (let n = 1; n <= 8; n++) {
    registerAction({
      id: `tabs.jump${n}`,
      title: `Go to tab ${n}`,
      chord: `Meta+${n}`,
      run: () => usePanesStore.getState().jumpTab(n - 1),
    });
  }
  registerAction({
    id: "tabs.last",
    title: "Go to last tab",
    chord: "Meta+9",
    run: () => usePanesStore.getState().lastTab(),
  });

  // — panes —
  registerAction({
    id: "panes.splitRight",
    title: "Split right",
    chord: "Meta+D",
    run: () => usePanesStore.getState().splitRight(),
  });
  registerAction({
    id: "panes.splitDown",
    title: "Split down",
    chord: "Meta+Shift+D",
    run: () => usePanesStore.getState().splitDown(),
  });
  registerAction({
    id: "panes.focusLeft",
    title: "Focus pane left",
    chord: "Meta+Alt+ArrowLeft",
    run: () => usePanesStore.getState().focusDir("left"),
  });
  registerAction({
    id: "panes.focusRight",
    title: "Focus pane right",
    chord: "Meta+Alt+ArrowRight",
    run: () => usePanesStore.getState().focusDir("right"),
  });
  registerAction({
    id: "panes.focusUp",
    title: "Focus pane up",
    chord: "Meta+Alt+ArrowUp",
    run: () => usePanesStore.getState().focusDir("up"),
  });
  registerAction({
    id: "panes.focusDown",
    title: "Focus pane down",
    chord: "Meta+Alt+ArrowDown",
    run: () => usePanesStore.getState().focusDir("down"),
  });
  registerAction({
    id: "panes.close",
    title: "Close pane",
    chord: "Meta+Alt+W",
    run: () => usePanesStore.getState().closePane(),
  });

  // — chrome —
  registerAction({
    id: "chrome.toggleFolders",
    title: "Toggle folders rail",
    chord: "Meta+0",
    run: () => useUiStore.getState().toggleFolders(),
  });
  registerAction({
    id: "chrome.toggleList",
    title: "Toggle note list",
    chord: "Alt+Meta+L",
    run: () => useUiStore.getState().toggleList(),
  });

  registerAction({
    id: "modules.notes",
    title: "Go to Notes",
    chord: "Ctrl+1",
    run: () => useUiStore.getState().setSwitcherOpen(false), // already the current module
  });
}
