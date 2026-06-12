// The first actions. Everything user-invocable registers here so ⌘K and
// Settings → Hotkeys (later phases) can list and rebind all of it.

import { hideMainWindow, toggleMainWindow } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { registerAction } from "./registry";

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

  registerAction({
    id: "panes.toggleFolders",
    title: "Toggle folders rail",
    chord: "Meta+0",
    run: () => useUiStore.getState().toggleFoldersRail(),
  });

  registerAction({
    id: "panes.toggleList",
    title: "Toggle note list",
    chord: "Alt+Meta+L",
    run: () => useUiStore.getState().toggleNoteList(),
  });

  registerAction({
    id: "modules.notes",
    title: "Go to Notes",
    chord: "Ctrl+1",
    run: () => useUiStore.getState().setSwitcherOpen(false), // already the current module
  });
}
