// The destinations model — the SINGLE source of truth for where a note can
// live, which roots are "hidden" from normal listings, and which are the
// never-delete sinks. ids ARE paths in fs mode (folderId "Brain/Work"), and the
// in-memory service mirrors that exactly (reserved folder id === its name), so
// DEST.brain === folder.id holds in BOTH modes.

/** The reserved roots. Inbox/Brain/Storage are everyday destinations; Board
 * stages quick captures as cards; Archive and Trash are the never-delete sinks. */
export const DEST = {
  inbox: "Inbox",
  brain: "Brain",
  storage: "Storage",
  board: "Board",
  archive: "Archive",
  trash: "Trash",
} as const;

export type Destination = (typeof DEST)[keyof typeof DEST];

/** The never-delete SINKS — Archive and Trash. Moving a note INTO one stamps the
 * origin breadcrumb (Restore reads it); moving back OUT clears it. This set MUST
 * mirror Rust `is_hidden_root` (corpus.rs) so the in-memory service and the disk
 * corpus agree on the lifecycle. Board is NOT a sink. */
export const SINK_ROOTS = [DEST.archive, DEST.trash] as const;

/** Roots excluded from All Notes, counts, and the "freshest note" pick: the two
 * sinks PLUS Board (captures stage there as cards, kept out of your note list
 * until you merge them). Broader than SINK_ROOTS — the origin rule uses isSink. */
export const HIDDEN_ROOTS = [DEST.archive, DEST.trash, DEST.board] as const;

/** True when folderId is excluded from All Notes — a hidden root or a descendant
 * of one (ids are paths). The predicate every listing trusts so the freshest-note
 * pick can never land on a trashed/archived/board note. */
export function isHidden(folderId: string): boolean {
  return HIDDEN_ROOTS.some((root) => folderId === root || folderId.startsWith(`${root}/`));
}

/** True for the never-delete sinks (Archive/Trash) and their subtrees — the
 * origin-rule predicate, kept in lockstep with Rust `is_hidden_root`. */
export function isSink(folderId: string): boolean {
  return SINK_ROOTS.some((root) => folderId === root || folderId.startsWith(`${root}/`));
}
