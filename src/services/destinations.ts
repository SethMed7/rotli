// The destinations model — the SINGLE source of truth for where a note can
// live, which roots are "hidden" from normal listings, and which are the
// never-delete sinks. ids ARE paths in fs mode (folderId "Storage/Work"), and
// the in-memory service mirrors that exactly (reserved folder id === its name),
// so DEST.inbox === folder.id holds in BOTH modes.
//
// Multi-root (Track 2): every id the default LOCAL root emits stays BARE
// ("Inbox", "Storage/Work") for zero migration. A NON-default root prefixes
// "<rootid>:" — e.g. the external Vault root emits "vault:wiki", "vault:chats".
// The Vault destination is therefore a ROOT MARKER ("vault:") — the part before
// ":" selects the CorpusRoot, the empty path after it means "the whole root".

/** The reserved-root id prefix marker. A folderId of the shape "<rootid>:"
 * (empty path) means the whole external root; "<rootid>:rel" is a folder inside
 * it. The default LOCAL root never uses a prefix — its ids stay bare. */
export const VAULT_ROOT_ID = "vault";

/** The Vault root marker id ("vault:"). The sidebar Vault row scopes to it; the
 * external memex (Seth's ~/smBrain) surfaces its wiki/ + chats/ underneath. */
export const VAULT_MARKER = `${VAULT_ROOT_ID}:`;

/** True when folderId targets the external Vault root (the marker itself or any
 * folder/note inside it). Used to BROWSE the vault read-mostly and to REDIRECT
 * note-creation away from it (notes default to the local Inbox, never the Vault). */
export function isVault(folderId: string): boolean {
  return folderId.startsWith(VAULT_MARKER);
}

/** True when folderId is a bare ROOT MARKER "<rootid>:" (a non-default root with
 * an empty path) — selecting the whole external root rather than a folder inside
 * it. Mirrors Rust `split_root_id("vault:") -> ("vault", "")`. The default LOCAL
 * root never produces a marker (its ids are bare), so this is non-default only. */
export function isRootMarker(folderId: string): boolean {
  const i = folderId.indexOf(":");
  return i > 0 && i === folderId.length - 1;
}

/** The reserved roots. Inbox/Storage are everyday LOCAL destinations; Board
 * stages quick captures as cards; Vault browses the external memex; Archive and
 * Trash are the never-delete sinks. Vault is a root marker, NOT a local folder. */
export const DEST = {
  inbox: "Inbox",
  vault: VAULT_MARKER,
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
