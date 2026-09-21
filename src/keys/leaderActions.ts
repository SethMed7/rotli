// The two leader chords (keys/leader.ts owns the second step). Registered from
// ./actions.ts with everything else; kept here so actions.ts stays under its
// size ceiling. Both are ordinary actions: listed in ⌘K and Settings → Hotkeys
// and rebindable. The Home front answers the request, because it owns the view
// menu and the rendered Main rows the numbers point at.

import { useUiStore } from "../state/ui";
import { registerAction } from "./registry";

function askHomeFront(id: "views" | "sidebar"): void {
  const ui = useUiStore.getState();
  // Breve owns the whole sidebar while it is up; leaving it can ask to confirm
  // a dirty form, which is not a hotkey's call to make
  if (ui.sidebarMode !== "notes") return;
  if (ui.sidebarCollapsed) ui.setSidebarCollapsed(false);
  if (ui.sidebarView !== "home") ui.setSidebarView("home");
  ui.requestLeader(id);
}

export function registerLeaderActions(): void {
  registerAction({
    id: "chrome.pickView",
    title: "Switch view — then ⌘1–9 picks one",
    defaultChord: "Meta+Shift+W",
    run: () => askHomeFront("views"),
  });
  registerAction({
    id: "chrome.pickNote",
    title: "Jump into the sidebar — then ⌘1–9 opens a top note",
    defaultChord: "Meta+Shift+S",
    run: () => askHomeFront("sidebar"),
  });
}
