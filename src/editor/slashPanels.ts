// Slash commands that open a panel rather than insert text (2026-09-28):
// /librarian swaps the format bar for the Librarian bar; /hand to AI opens
// Hand to AI's prompt for this note (the owner: "let me do hand to ai via a
// slash command").

import { openLibrarianBar } from "../state/librarianBar";
import { useUiStore } from "../state/ui";

export function openSlashPanel(kind: "librarian" | "handToAi", paneId: string, noteId: string): void {
  if (kind === "librarian") openLibrarianBar(paneId);
  else useUiStore.getState().setHandToAiNoteId(noteId);
}
