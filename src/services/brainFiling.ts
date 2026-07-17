// Manual Brain filing — ONE path shared by every surface that files a note into
// a wiki area (the metadata panel's "File to the Brain" and the right-click
// menu's drill). A `.md` note travels the wire as its frontmatter ULID, but the
// filing journal + staged-detection speak PATHS — so the flow starts by
// resolving through the ULID→rel bridge (corpus_note_path). The move itself
// runs through the v3.7 Filer gate, any open pane retargets, and the action is
// journaled so Brain Activity can show + undo it. UI concerns (busy/error/
// close) stay with the callers.

import { corpusFileNote, corpusNotePath, corpusSetAiField } from "../lib/tauri";
import { usePanesStore } from "../state/panes";
import { logAction } from "./brainJournalStore";
import { invalidateJournal, invalidateNotes } from "./hooks";

/** File a note (by wire id or rel path) into `wiki/<area>`: set the AI area
 * field, move through the Filer gate, retarget open panes, journal it, refresh.
 * Throws on refusal (locked note, bad area, not a memex note) — callers surface
 * it. Returns the note's new rel path. `journal:false` = the caller owns the
 * journal row (approving a daemon proposal transitions the PROPOSAL's id —
 * a fresh row here would double-log the same move). */
export async function fileNoteToArea(
  noteId: string,
  area: string,
  opts?: { journal?: boolean },
): Promise<string> {
  const rel = await corpusNotePath(noteId);
  const before = rel.slice(0, rel.lastIndexOf("/"));
  const title = (rel.split("/").pop() ?? rel)
    .replace(/-[a-z0-9]{6}\.md$/i, "")
    .replace(/\.md$/, "");
  await corpusSetAiField(rel, "area", area);
  const newRel = await corpusFileNote(rel);
  // a .md note's wire id is its ULID and survives the move — only a tab that was
  // opened BY rel path needs retargeting (a no-op otherwise).
  usePanesStore.getState().retargetNote(rel, newRel);
  if (opts?.journal !== false) {
    await logAction({
      action: "file",
      noteId: newRel,
      noteTitle: title,
      area,
      before,
      after: newRel.slice(0, newRel.lastIndexOf("/")),
    });
    // queries never go stale on their own (staleTime ∞) — a fresh journal row
    // must push itself into Activity + the sidebar badge
    await invalidateJournal();
  }
  await invalidateNotes();
  return newRel;
}
