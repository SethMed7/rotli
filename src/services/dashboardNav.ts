// The ONE way to open the Model usage dashboard (the dashboard surface's
// "models" lens). The Chat front's usage card was its door until 2026-11-24;
// now ⌘K ("Model usage") and Settings → AI Models open it through here, so
// both land identically: Settings closed, the notes sidebar, then the lens.
//
// A store-mutating command module, so it lives in services/ rather than lib/
// (docs/development/adding-things.md).

import { useUiStore } from "../state/ui";

export function openModelUsage(): void {
  const ui = useUiStore.getState();
  ui.setSettingsOpen(false);
  ui.setSidebarMode("notes");
  ui.setDashboardSection("models");
  ui.setContentView("dashboard");
}
