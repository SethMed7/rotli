// Keys for a folder opened from Finder in its own window (docs/design/
// open-in-rotli.md, stage 2). Same bundle and registry; only main's tab, pane,
// and zoom chords are opted in by id (alsoOnSurface). No new-note, palette,
// vault, or view command reaches it: the folder is edited in place, never
// added to.

import { alsoOnSurface } from "./registry";

const ALSO_IN_FOLDER_WINDOW = [
  "tabs.close",
  "tabs.cycle",
  "tabs.cyclePrev",
  "tabs.reopen",
  "tabs.last",
  ...Array.from({ length: 8 }, (_unused, index) => `tabs.jump${index + 1}`),
  "panes.splitRight",
  "panes.splitDown",
  "panes.focusLeft",
  "panes.focusRight",
  "panes.focusUp",
  "panes.focusDown",
  "panes.close",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomReset",
];

export function registerFolderWindowActions(): void {
  for (const id of ALSO_IN_FOLDER_WINDOW) alsoOnSurface(id, "folder");
}
