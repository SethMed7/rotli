// The two whole-window view modes: Focus (⌥⌘F: chrome leaves, one centered
// column) and Reading (⌥⌘R: Focus, and the note only to read, with nothing that
// reacts to the pointer and no spelling marks). Esc leaves either one
// (actions.ts app.hide), since reading mode always rides on focus mode.
// Registered from ./actions.ts; kept here so actions.ts stays under its size
// ceiling.

import { useUiStore } from "../state/ui";
import { registerAction } from "./registry";

export function registerViewModeActions(): void {
  registerAction({
    id: "view.focus",
    title: "Focus mode",
    defaultChord: "Alt+Meta+F",
    run: () => {
      const ui = useUiStore.getState();
      if (ui.sidebarMode === "breve") return;
      ui.setSettingsOpen(false);
      ui.setFocusMode(!ui.focusMode);
    },
  });
  registerAction({
    id: "view.reading",
    title: "Reading mode",
    defaultChord: "Alt+Meta+R",
    run: () => {
      const ui = useUiStore.getState();
      if (ui.sidebarMode === "breve") return;
      ui.setSettingsOpen(false);
      ui.setReadingMode(!ui.readingMode);
    },
  });
}
