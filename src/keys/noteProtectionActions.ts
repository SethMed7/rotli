// Note-protection actions. Registered from ./actions.ts with everything else;
// kept here so actions.ts stays under its size ceiling and the secure/locked
// verbs have one home as they grow.

import { corpusSetSecure } from "../lib/tauri";
import { invalidateNotes, lifecycleError } from "../services/hooks";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { focusedNoteIdNow, notesWorkspaceActive } from "./focusNow";
import { registerAction } from "./registry";

export function registerNoteProtectionActions(): void {
  // Mark the FOCUSED note secure (the owner, 2026-09-18: "hot key for marking a
  // note secure"). One direction only: a stray chord must never EXPOSE a note
  // to remote AI, so removing protection stays a deliberate menu choice.
  registerAction({
    id: "notes.markSecure",
    title: "Mark note secure — block remote AI",
    defaultChord: "Meta+Shift+L",
    run: () => {
      if (!notesWorkspaceActive()) return;
      const id = focusedNoteIdNow();
      if (!id) return;
      markNoteDraftChanged(id);
      void corpusSetSecure(id, true).then(invalidateNotes).catch(lifecycleError("mark secure"));
    },
  });
}
