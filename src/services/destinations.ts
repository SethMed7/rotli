// The destinations model — the SINGLE source of truth for where a note can
// live and which roots are "hidden" from normal listings. ids ARE paths in fs
// mode (folderId "Brain/Work"), and the in-memory service mirrors that exactly
// (reserved folder id === its name), so DEST.brain === folder.id holds in BOTH
// modes. Lifecycle move/archive/trash methods are Phase 2; this file is only
// the model + the exclusion rule the listings lean on (Seth, 2026-06-13).

/** The five reserved roots. Inbox/Brain/Storage are the everyday destinations;
 * Archive and Trash are the two hidden ones (see HIDDEN_ROOTS / isHidden). */
export const DEST = {
  inbox: "Inbox",
  brain: "Brain",
  storage: "Storage",
  archive: "Archive",
  trash: "Trash",
} as const;

export type Destination = (typeof DEST)[keyof typeof DEST];

/** The roots excluded from normal listings and counts — Archive and Trash. */
export const HIDDEN_ROOTS = [DEST.archive, DEST.trash] as const;

/** True when folderId is a hidden root OR nests under one (ids are paths, so a
 * descendant starts with "<root>/"). The one predicate every listing trusts so
 * the "freshest note" pick can never land on a trashed/archived note. */
export function isHidden(folderId: string): boolean {
  return HIDDEN_ROOTS.some(
    (root) => folderId === root || folderId.startsWith(`${root}/`),
  );
}
