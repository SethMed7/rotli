// Where a note "lives", as a short human label for the editor's location chip
// (the maintainer, 2026-07-03: "I can't find where this file is"). Pure — derived from the
// note's folderId + whether it's referenced in Main. Main is a shortcut, so a
// note in Main ALSO has a Brain/disk home; the label shows both ("★ Main · …").

import type { NoteSummary } from "../types";

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The note's disk/Brain home, humanized (no Main prefix). */
export function brainLocationLabel(folderId: string): string {
  const f = folderId || "";
  // "Library" is the Brain area's display name (Librarian rename, 2026-07-26)
  if (f === "wiki") return "Library";
  if (f === "wiki/_secure" || f.startsWith("wiki/_secure/")) return "Library › Secure notes";
  if (f.startsWith("wiki/_")) return "Captures"; // _inbox note-staging etc.
  if (f.startsWith("wiki/")) return titleCase(f.slice("wiki/".length).replace(/\//g, " › "));
  if (f === "Board") return "Captures";
  if (f === "Archive" || f === "Trash") return f;
  // "Assets" is Storage's display name (2026-07-25) — ids keep the old word
  if (f.startsWith("Storage")) return f.replace(/^Storage/, "Assets").replace(/\//g, " › ");
  if (f.startsWith("vault:")) {
    // a CONNECTED vault — "Linked library" so it can't be confused with the
    // local Library (the Librarian's own area; rename 2026-07-26)
    const sub = f.slice("vault:".length).replace(/^wiki\//, "");
    return sub ? `Linked library › ${titleCase(sub.replace(/\//g, " › "))}` : "Linked library";
  }
  if (f === "" || f === "Inbox") return "Inbox";
  return f;
}

/** The full location for the editor chip. `inMain` prefixes "★ Main · ". */
export function noteLocationLabel(folderId: string, inMain: boolean): string {
  const base = brainLocationLabel(folderId);
  return inMain ? `★ Main · ${base}` : base;
}

/** The physical folder wins for location/reveal; browser/demo notes created
 * before the dual-location wire shape fall back to their projected folder. */
export function noteDiskFolder(note: Pick<NoteSummary, "folderId" | "diskFolderId">): string {
  return note.diskFolderId ?? note.folderId;
}

/** A Brain row is a second view of the same note, projected onto its physical
 * wiki folder. Shelves keep owning `folderId` everywhere else. */
export function projectNoteToBrain(note: NoteSummary): NoteSummary | null {
  const folderId = noteDiskFolder(note);
  const isBrainNote =
    (note.kind === undefined || note.kind === "note") &&
    (folderId === "wiki" || folderId.startsWith("wiki/")) &&
    !folderId.startsWith("wiki/_");
  return isBrainNote ? { ...note, folderId } : null;
}
