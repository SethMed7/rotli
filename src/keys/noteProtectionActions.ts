// Note-protection actions. Registered from ./actions.ts with everything else;
// kept here so actions.ts stays under its size ceiling and the secure/locked
// verbs have one home as they grow.

import { corpusFrontmatter, corpusSetSecure } from "../lib/tauri";
import { invalidateNotes, lifecycleError } from "../services/hooks";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { focusedNoteIdNow, notesWorkspaceActive } from "./focusNow";
import { registerAction } from "./registry";
import { flipSecure } from "./secureFlip";

export const TOGGLE_SECURE_ACTION = "notes.toggleSecure";

/** Flip a note's secure flag and answer the new state. ONE path for the chord,
 * the Aa panel's switch, and anything later (the rule is secureFlip.ts). An
 * explicit protection change is intent to keep the note, so it can no longer be
 * discarded as a blank draft. */
export async function toggleNoteSecure(noteId: string): Promise<boolean> {
  markNoteDraftChanged(noteId);
  const secure = await flipSecure(noteId, { read: corpusFrontmatter, write: corpusSetSecure });
  await invalidateNotes();
  return secure;
}

export function registerNoteProtectionActions(): void {
  // Secure on/off for the FOCUSED note (the owner, 2026-09-18: "hot key for
  // marking a note secure … should also work for undoing the secure"). It
  // toggles by his decision; the Aa panel shows the state and the same chord.
  registerAction({
    id: TOGGLE_SECURE_ACTION,
    title: "Secure note on / off — block remote AI",
    defaultChord: "Meta+Shift+L",
    run: () => {
      if (!notesWorkspaceActive()) return;
      const id = focusedNoteIdNow();
      if (id) void toggleNoteSecure(id).catch(lifecycleError("change secure"));
    },
  });
}
