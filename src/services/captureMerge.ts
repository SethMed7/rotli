// Captures → "Make a note" / "Merge N into a note": the selected cards become
// ONE note, bodies joined oldest-first, created through the same router every
// other creation site uses. Writing straight into the literal `Inbox` folder
// (the shape until 2026-09-16) worked only in a legacy vault: in a memex
// layout that folder is not a writable surface, Rust refused, and the
// button did visibly nothing.

import { createRoutedNote } from "./createNote";
import { DEST } from "./destinations";

/** Join capture bodies in the order given, dropping empties, one blank line
 * between cards. Pure; exported for tests. */
export function joinCaptureBodies(bodies: Array<string | null | undefined>): string {
  return bodies
    .map((body) => body?.trim() ?? "")
    .filter((body) => body.length > 0)
    .join("\n\n");
}

/** Create the merged note where a new note from the Captures view belongs
 * (a smart-row selection: memex staging when the vault is writable, else the
 * local Inbox) and return its wire id for opening. */
export function createMergedCaptureNote(body: string): Promise<string> {
  // merged captures stay captures: the capture shelf keeps the card on the board
  return createRoutedNote({
    selectedFolderId: DEST.board,
    isSmart: true,
    localFallback: DEST.inbox,
    body,
    shelf: ["Inbox"],
  });
}
