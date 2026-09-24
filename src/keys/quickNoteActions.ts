// The Quick Note window's own keys (surface: quick). Registered from
// ./actions.ts with everything else; kept here so actions.ts stays under its
// size ceiling. new/search/pick reach the mounted component through
// quickHandle; cycle/remove act on the set store; dismiss unwinds a transient
// (the picker) before hiding the window.

import { hideQuickWindow } from "../lib/tauri";
import { cycleQuick, removeQuickNote } from "../state/quick";
import { useUiStore } from "../state/ui";
import { quickHandle } from "./handles";
import { TOGGLE_SECURE_ACTION } from "./noteProtectionActions";
import { alsoOnSurface, registerAction } from "./registry";

/** Picker rows the number chords reach: ⌘1–⌘9, then ⌘⇧1–⌘⇧9 (the owner,
 * 2026-09-23: "cmd+# to get through 1-9 and cmd+shift+# for 10-19"). */
export const QUICK_PICK_ROWS = 18;

/** The row a quick.pick action opens (0-based), and its default chord. */
export function quickPickChord(row: number): string {
  return row < 9 ? `Meta+${row + 1}` : `Meta+Shift+${row - 8}`;
}

/** main's note commands that also belong to the Quick Note: they act on the
 * note it has open (focusNow.ts resolves it there). */
const ALSO_IN_QUICK_NOTE = [TOGGLE_SECURE_ACTION];

export function registerQuickNoteActions(): void {
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
  for (let row = 0; row < QUICK_PICK_ROWS; row++) {
    registerAction({
      id: `quick.pick${row + 1}`,
      title: `Quick note — open picker row ${row + 1}`,
      defaultChord: quickPickChord(row),
      surface: "quick",
      run: () => quickHandle()?.openRow(row),
    });
  }
  for (const id of ALSO_IN_QUICK_NOTE) alsoOnSurface(id, "quick");
}
