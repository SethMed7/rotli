// Organize means "it works for me in the back" (the maintainer, 2026-07-31). Metadata
// suggestions can still land in the Waiting lane at the Organize rung — rows
// minted at a lower rung, or before an update — and they used to sit there
// until manually approved, which contradicts what Organize promises. This
// adopter applies them in the background through the SAME guarded approve
// lane the buttons use (freshness re-checks, learn-field, journaled as
// applied — fully undoable in the Librarian).
//
// FILE moves are exempt on purpose: a pending "file it" row is a
// below-confidence filing guess, and a guess never files itself (§6.4) — it
// keeps waiting for a human at every rung.

import { useOrganizerLive } from "../state/organizerLive";
import { useUiStore } from "../state/ui";
import { deriveJournal } from "./brainJournal";
import { approveProposal } from "./brainJournalComposition";
import { readJournal } from "./brainJournalStore";
import { invalidateJournal, invalidateNotes } from "./hooks";

let running = false;

/** Idempotent + re-entrancy-safe: call it on startup and on every journal
 * beat; it no-ops unless Organize is on and adoptable rows exist. */
export async function adoptPendingAtOrganize(): Promise<void> {
  if (running) return;
  const ui = useUiStore.getState();
  if (!ui.brainEnabled || ui.organizerTrust !== "organize") return;
  // the guard must close BEFORE the first await (review F1) — StrictMode's
  // double-mounted startup effect, or a journal beat landing mid-read, would
  // otherwise run two interleaved batches over the same rows
  running = true;
  try {
    const { pending } = deriveJournal(await readJournal());
    const adoptable = pending.filter((a) => a.action === "field" || a.action === "index");
    if (adoptable.length === 0) return;
    let applied = 0;
    for (const a of adoptable) {
      // trust can drop mid-batch — stop adopting the moment Organize ends
      const now = useUiStore.getState();
      if (!now.brainEnabled || now.organizerTrust !== "organize") break;
      // the ambient working signal — the sidebar's footer dot (titles only)
      useOrganizerLive.getState().setLive(true, a.noteTitle || null);
      try {
        await approveProposal(a);
        applied += 1;
      } catch {
        // freshness guard: the note changed since — the daemon re-evaluates
        // it on its own pass; leave the row for supersede
      }
    }
    if (applied > 0) {
      await invalidateNotes();
      await invalidateJournal();
    }
  } finally {
    useOrganizerLive.getState().setLive(false);
    running = false;
  }
}
