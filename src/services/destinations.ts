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
 * external memex (the maintainer's ~/memex-vault) surfaces its wiki/ + chats/ underneath. */
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

/** Rotli's own folders in an IMPORTED vault — a copy of someone's notes folder
 * whose memex.json says `"layout": "imported"` (src-tauri/src/vault_roles.rs).
 * Every top-level folder there is the person's, so a copied `Archive/` is an
 * ordinary folder and Rotli's sinks live under names of their own. Ids in an
 * imported vault are disk paths, so these are folder ids too. */
export interface FolderRoles {
  inbox: string;
  archive: string;
  trash: string;
  chats: string;
  storage: string;
}

/** The map every import writes — byte-identical to Rust
 * `FolderRoles::imported` (parity.json importedFolderRoles). */
export const IMPORTED_FOLDER_ROLES: FolderRoles = {
  inbox: "Inbox",
  archive: "Archive (Rotli)",
  trash: "Trash (Rotli)",
  chats: "chats (Rotli)",
  storage: "storage (Rotli)",
};

/** One top-level folder name a role may use — Rust `usable_name`. */
function usableRoleName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim() !== "" &&
    name.trim() === name &&
    !name.startsWith(".") &&
    !/[/\\:]/.test(name) &&
    name.toLowerCase() !== "memex.json"
  );
}

/** The role map a root `memex.json` declares — the Rust `vault_roles::read`
 * twin. Null unless the marker is Rotli's (`mx_` id) and says
 * `"layout": "imported"`. An unusable entry falls back to that role's
 * default, and two roles sharing a folder fall back whole. */
export function folderRolesFromMarker(markerJson: string): FolderRoles | null {
  let marker: unknown;
  try {
    marker = JSON.parse(markerJson);
  } catch {
    return null;
  }
  if (!marker || typeof marker !== "object") return null;
  const { id, layout, folders } = marker as Record<string, unknown>;
  if (typeof id !== "string" || !id.startsWith("mx_") || layout !== "imported") return null;
  const map = folders && typeof folders === "object" ? (folders as Record<string, unknown>) : {};
  const roles = { ...IMPORTED_FOLDER_ROLES };
  for (const key of Object.keys(roles) as (keyof FolderRoles)[]) {
    const name = map[key];
    // a sink, chat, or storage role must name a folder Rotli made (Rust from_marker)
    if (usableRoleName(name) && (key === "inbox" || name.includes("(Rotli)"))) roles[key] = name;
  }
  const names = Object.values(roles).map((name) => name.toLowerCase());
  return new Set(names).size === names.length ? roles : { ...IMPORTED_FOLDER_ROLES };
}

/** The active vault's role map: null for a Rotli vault or a plain folder,
 * whose reserved names are fixed. Set once per vault load (Location config on
 * the Mac, the marker on Rotli Web) — never per call site. */
let activeRoles: FolderRoles | null = null;

export function setFolderRoles(roles: FolderRoles | null): void {
  activeRoles = roles;
}

export function folderRoles(): FolderRoles | null {
  return activeRoles;
}

/** The reserved roots. Inbox/Storage are everyday LOCAL destinations; Board
 * stages quick captures as cards; Vault browses the external memex; Archive and
 * Trash are the never-delete sinks. Vault is a root marker, NOT a local folder.
 * Inbox, Storage, Archive, and Trash answer from the active role map, so an
 * imported vault's sinks are Rotli's own and never the person's `Archive/`. */
export const DEST = {
  get inbox(): string {
    return activeRoles?.inbox ?? "Inbox";
  },
  secure: "Secure notes",
  vault: VAULT_MARKER,
  get storage(): string {
    return activeRoles?.storage ?? "Storage";
  },
  board: "Board",
  get archive(): string {
    return activeRoles?.archive ?? "Archive";
  },
  get trash(): string {
    return activeRoles?.trash ?? "Trash";
  },
};

/** The destination rows Rotli Web's folder list leads with, in this order
 * (folderNotes.ts listFolders): projections, not folders on disk. id === name,
 * no parent — the same grammar the in-memory service seeds, so
 * `DEST.inbox === folder.id` holds in every mode. */
export function reservedFolders(): string[] {
  return [DEST.inbox, DEST.secure, DEST.storage, DEST.board, DEST.archive, DEST.trash];
}

export type Destination = string;

/** The never-delete SINKS — Archive and Trash. Moving a note INTO one stamps the
 * origin breadcrumb (Restore reads it); moving back OUT clears it. This set MUST
 * mirror Rust `is_hidden_root` (corpus_layout.rs) so the in-memory service and
 * the disk corpus agree on the lifecycle. Board is NOT a sink. */
export function sinkRoots(): string[] {
  return [DEST.archive, DEST.trash];
}

/** Roots excluded from All Notes, counts, and the "freshest note" pick: the two
 * sinks PLUS Board (captures stage there as cards, kept out of your note list
 * until you merge them). Broader than sinkRoots — the origin rule uses isSink. */
export function hiddenRoots(): string[] {
  return [DEST.archive, DEST.trash, DEST.board];
}

/** True when folderId is excluded from All Notes — a hidden root or a descendant
 * of one (ids are paths). The predicate every listing trusts so the freshest-note
 * pick can never land on a trashed/archived/board note. */
export function isHidden(folderId: string): boolean {
  return hiddenRoots().some((root) => folderId === root || folderId.startsWith(`${root}/`));
}

/** True for the never-delete sinks (Archive/Trash) and their subtrees — the
 * origin-rule predicate, kept in lockstep with Rust `is_hidden_root`. */
export function isSink(folderId: string): boolean {
  return sinkRoots().some((root) => folderId === root || folderId.startsWith(`${root}/`));
}

/** The Assets lane (Storage and its subtree) — the MANAGED BINARY home. A note
 * must never be BORN here (P0 sweep 2026-07-28: browsing Assets then ⌘N used to
 * drop a markdown note inside storage/), so creation routing treats it like a
 * hidden root. */
export function isStorageLane(folderId: string): boolean {
  return folderId === DEST.storage || folderId.startsWith(`${DEST.storage}/`);
}

/** The disk folder binaries live in, by its own id: a Rotli vault's
 * lowercase `storage/` (projected to the Storage destination), or an imported
 * vault's role folder. Never the person's own `storage/` in an imported vault. */
export function isStorageDisk(folderId: string): boolean {
  const lane = activeRoles?.storage ?? "storage";
  return folderId === lane || folderId.startsWith(`${lane}/`);
}

/** Trash and its subtree only — the ONE root note SEARCH never surfaces
 * (Archive stays findable; restore is what resurrects Trash). Mirrors Rust
 * `is_trash_folder` (corpus.rs). */
export function isTrash(folderId: string): boolean {
  return folderId === DEST.trash || folderId.startsWith(`${DEST.trash}/`);
}

/** Does an item whose REAL home is `folderId` live under sidebar destination (or
 * plain folder) `destId`? The sidebar's derived highlight rule (the maintainer #1,
 * 2026-07-08): a destination row only reads "selected" while the focused
 * content actually lives under it. The two aliased destinations map to their
 * disk shapes — "Brain" ⇔ wiki/*, "Storage" ⇔ memex storage/* AND the legacy
 * Storage/* folder; everything else (Archive, Trash, Inbox, vault: markers,
 * plain folders) is a literal prefix match. Pure. */
export function destContains(destId: string, folderId: string): boolean {
  // a BARE root marker ("vault:", "lib:") — ids inside it are "vault:wiki/x",
  // colon-joined with NO slash after the marker, so the plain prefix rule below
  // would never match (reviewer blocker, 2026-07-08)
  if (isRootMarker(destId)) return folderId.startsWith(destId);
  const under = (root: string) => folderId === root || folderId.startsWith(`${root}/`);
  // an imported vault has no projected lanes: the person's wiki/ and storage/
  // are ordinary folders
  if (activeRoles) return under(destId);
  if (destId === "Brain") return under("wiki");
  if (destId === DEST.secure) return under("wiki/_secure") || under(DEST.secure);
  if (destId === DEST.storage) return under("storage") || under(DEST.storage);
  return under(destId);
}

/** True when folderId has the chats/ SHAPE — "chats", "chats/x", and the
 * prefixed "vault:chats/x". A pure path test: whether it MEANS a Chat-front
 * transcript depends on the root's layout (see `isChats`). `:` can never
 * appear inside a path component (Rust validate_component refuses it), so the
 * first `:` is always the root marker. Mirrors Rust `is_chats_lane`. */
export function isChatsPath(folderId: string): boolean {
  const i = folderId.indexOf(":");
  const rel = i >= 0 ? folderId.slice(i + 1) : folderId;
  // the active vault's own ids are bare; an imported one keeps Rotli's chats
  // under its role name, and its `chats/` is the person's
  const chats = i < 0 && activeRoles ? activeRoles.chats : "chats";
  return rel === chats || rel.startsWith(`${chats}/`);
}

/** True when folderId has the curated-wiki SHAPE — "wiki", "wiki/x", and the
 * prefixed "vault:wiki/x". In a memex layout the Rust write gate refuses note
 * CREATION anywhere under wiki/** (only the AI Filer and the wiki/_inbox
 * staging write there), so pickers that choose a create-destination must never
 * offer these ids (#6, audit 2026-07). Same rel-slicing rule as isChatsPath. */
export function isWikiPath(folderId: string): boolean {
  // an imported vault's wiki/ is the person's ordinary folder
  if (activeRoles && !folderId.includes(":")) return false;
  const i = folderId.indexOf(":");
  const rel = i >= 0 ? folderId.slice(i + 1) : folderId;
  return rel === "wiki" || rel.startsWith("wiki/");
}

/** The root markers whose layout is a MEMEX — "" for the local corpus when it
 * is one, "<rootid>:" per connected brain (a brain IS a memex by definition).
 * Added plain folders stay out: a plain root has no Chat front, so its "chats"
 * folder is just a folder. Pure derivation over the Location config shape —
 * the session cache lives in fsNotes.ts (`memexRootMarkers`). */
export function memexMarkersOf(cfg: {
  corpus: { isMemex: boolean; folderRoles?: FolderRoles | null };
  brains: { id: string }[];
}): ReadonlySet<string> {
  const markers = new Set<string>();
  // an imported vault has Rotli's chat lane too, under its role name
  if (cfg.corpus.isMemex || cfg.corpus.folderRoles) markers.add("");
  for (const b of cfg.brains) markers.add(`${b.id}:`);
  return markers;
}

/** True for a memex chats/ TRANSCRIPT — the chats/ shape inside a root whose
 * layout is a memex. Chat transcripts belong to the Chat front (All chats);
 * they never ride note listings or note search (the "chats leak into All
 * notes" fix, 2026-07-01). In a PLAIN root a folder named "chats" is just a
 * folder and stays listed/searchable — mirrors Rust store.search's
 * `is_chats_lane` gate (a Rotli vault's or an imported vault's chats). */
export function isChats(folderId: string, memexMarkers: ReadonlySet<string>): boolean {
  const i = folderId.indexOf(":");
  const marker = i > 0 ? folderId.slice(0, i + 1) : "";
  return memexMarkers.has(marker) && isChatsPath(folderId);
}
