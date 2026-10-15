// The window's first tab after a vault opens: a placeholder (noteId "") that
// becomes the vault's freshest note once the corpus answers. This ran only on
// the app's first mount, so a vault opened later — every vault chosen in
// setup, every switch — kept the placeholder, shown as an "Untitled" tab over
// an empty pane (the owner's UAT, 2026-10-15). Now it runs after each vault
// switch too, and a vault with no notes closes the placeholder instead.

import { hasDurableCorpus } from "../lib/tauri";
import { notesService } from "../services/notes";
import { usePanesStore } from "./panes";
import { activeTabOf, leaves } from "./paneTree";

/** True while the window still shows only the startup placeholder. */
export function onlyPlaceholderTab(): boolean {
  const panes = leaves(usePanesStore.getState().root);
  const only = panes[0];
  const tab = only && only.tabs.length === 1 ? activeTabOf(only) : null;
  return panes.length === 1 && !!tab && tab.surfaceKind === "note" && tab.noteId === "";
}

/** Fill the placeholder with the freshest note, or close it when there is
 * none. Never replaces anything the person opened meanwhile. */
export async function fillStartupTab(): Promise<void> {
  if (!hasDurableCorpus()) return;
  const notes = await notesService.listNotes();
  if (!onlyPlaceholderTab()) return;
  const next = placeholderFill(notes);
  if (next.open) {
    usePanesStore.getState().openNote(next.open);
    return;
  }
  const only = leaves(usePanesStore.getState().root)[0];
  if (only) usePanesStore.setState({ root: { ...only, tabs: [], activeTabId: "" }, focusedPaneId: only.id });
}

/** What the placeholder becomes: the freshest NOTE (a board or canvas opened
 * here as a broken note tab), or nothing at all when the vault has none. */
export function placeholderFill(notes: readonly { id: string; kind?: string }[]): { open: string | null } {
  return { open: notes.find((note) => (note.kind ?? "note") === "note")?.id ?? null };
}
