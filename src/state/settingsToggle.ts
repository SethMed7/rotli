// The Settings surface toggle behind ⌘, and the sidebar button. Leaving an
// unsaved Breve draft asks first; opening Settings also leaves focus mode, the
// palette, and any non-pane content view so Settings is what you see.

import { useUiStore } from "./ui";

export function toggleSettings(
  confirmDiscard: (message: string) => boolean = (m) => window.confirm(m),
): void {
  const ui = useUiStore.getState();
  if (
    !ui.settingsOpen &&
    ui.sidebarMode === "breve" &&
    ui.breveDirty &&
    !confirmDiscard("Discard your unsaved Breve changes and open Settings?")
  )
    return;
  if (!ui.settingsOpen && ui.sidebarMode === "breve") ui.setBreveDirty(false);
  ui.setPaletteOpen(false);
  ui.setFocusMode(false);
  ui.setContentView("panes");
  ui.setSettingsOpen(!ui.settingsOpen);
}
