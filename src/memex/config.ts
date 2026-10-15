// The rotli-side view of "which brain am I writing to." The unified `corpus.json`
// (read via corpus_list_config) is the source of truth; this maps its view shape
// into the app's MemexInstance model + a couple of pure reducers. The corpus is
// THE one folder = your notes = your brain: when it's a memex it IS the active
// write target; otherwise the active CONNECTED brain is. Other connected brains
// surface as additional (read-only) instances.

import type { CorpusConfigView, MemexPerms } from "../lib/tauri";
import type { FolderRoles } from "../services/destinations";

export type Perms = MemexPerms;

/** The synthetic instance id for "the corpus itself is a brain". */
export const CORPUS_INSTANCE_ID = "corpus";

export interface MemexInstance {
  id: string;
  label: string;
  /** Absolute path to the memex root. */
  root: string;
  role: string;
  memexId: string | null;
  /** Access mode snapshot ("local"|"open"|"secure"); re-read on open. */
  mode: string | null;
  perms: Perms;
  /** The vault's Librarian switch (per-root display fact; raw = false). */
  brainEnabled: boolean;
  /** "memex": a Rotli vault, whose new notes take the Library lanes
   * (`wiki/_inbox`). "imported": a vault the person brought (a copy, or a
   * folder connected in place) — its chats live in its own chats folder, but
   * its notes go through the corpus store into its Inbox, never `wiki/`. */
  layout: "memex" | "imported";
  /** Connected in place (decision I): the Librarian never runs here and
   * Rotli never stamps the person's notes. */
  inPlace: boolean;
  /** A brought-in vault's own folders by role; null for a Rotli vault. */
  folderRoles?: FolderRoles | null;
}

export interface MemexConfig {
  activeId: string | null;
  instances: MemexInstance[];
  developmentReadOnly: boolean;
  /** The open folder when it is NOT a vault (an adopted Markdown or Obsidian
   * folder): display-only, for the vault switcher. Never a write target, so it
   * stays out of `instances`. */
  currentFolder?: MemexInstance | null;
  /** The open folder was opened in place, so the Librarian never organizes it
   * (docs/design/vault-copy-and-obsidian-compatibility.md): Settings offers a
   * copy with the Librarian instead. */
  openedInPlace?: boolean;
}

function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "brain";
}

/** Map the unified corpus view into the app's instance model. A memex corpus
 * becomes the (active) `CORPUS_INSTANCE_ID` instance; connected brains follow.
 * When the corpus is NOT a memex, the active CONNECTED brain stays the write
 * target — so an existing "plain corpus + connected brain" setup is unchanged. */
export function fromCorpusConfig(v: CorpusConfigView): MemexConfig {
  const instances: MemexInstance[] = [];
  // A brought-in vault is a vault too: its chats are written into it (its
  // role map's chats folder), so it is the write target — never a connected
  // brain beside it (which is where its chats went before, 2026-10-15).
  const corpusIsVault = v.corpus.isMemex || !!v.corpus.folderRoles;
  if (corpusIsVault) {
    instances.push({
      id: CORPUS_INSTANCE_ID,
      label: baseName(v.corpus.absPath),
      root: v.corpus.absPath,
      role: "corpus",
      memexId: v.corpus.memexId,
      mode: null,
      perms: v.corpus.perms ?? "read-only",
      brainEnabled: v.corpus.brainEnabled ?? true,
      ...brought(v.corpus.folderRoles, v.corpus.adopted),
    });
  }
  for (const b of v.brains) {
    instances.push({
      id: b.id,
      label: b.label,
      root: b.absPath,
      role: "brain",
      memexId: b.memexId,
      mode: b.mode,
      perms: b.perms,
      brainEnabled: b.brainEnabled ?? true,
      ...brought(b.folderRoles, b.adopted),
    });
  }
  const activeId = corpusIsVault ? CORPUS_INSTANCE_ID : v.activeBrainId;
  const currentFolder: MemexInstance | null =
    !corpusIsVault && v.corpus.absPath
      ? {
          id: CORPUS_INSTANCE_ID,
          label: baseName(v.corpus.absPath),
          root: v.corpus.absPath,
          role: "corpus",
          memexId: null,
          mode: null,
          perms: "read-only",
          brainEnabled: v.corpus.brainEnabled ?? true,
          layout: "memex",
          inPlace: v.corpus.adopted === true,
        }
      : null;
  return {
    activeId,
    instances,
    developmentReadOnly: v.developmentReadOnly,
    currentFolder,
    openedInPlace: v.corpus.adopted === true,
  };
}

export const activeInstance = (c: MemexConfig): MemexInstance | null =>
  c.instances.find((i) => i.id === c.activeId) ?? null;

/** Whether this instance can be written to (perms + a connected, in-range brain). */
export const isWritable = (i: MemexInstance | null): boolean => i?.perms === "chats+inbox";

/** Whether new notes may take this vault's Library lanes (`wiki/_inbox`): a
 * writable Rotli vault only. A brought-in vault writes chats but keeps new
 * notes in its Inbox through the corpus store. The ONE predicate every
 * note-creating path asks, so no `wiki/` tree is ever made there. */
export const noteLaneWritable = (i: MemexInstance | null): boolean => isWritable(i) && i?.layout === "memex";

/** The layout facts of a vault view: a role map means a brought-in vault. */
function brought(
  folderRoles: FolderRoles | null | undefined,
  adopted: boolean | undefined,
): Pick<MemexInstance, "layout" | "inPlace" | "folderRoles"> {
  return {
    layout: folderRoles ? "imported" : "memex",
    inPlace: adopted === true,
    folderRoles: folderRoles ?? null,
  };
}

/** The open folder when it was connected in place: the corpus instance of a
 * marked folder, else the display-only folder of an unmarked one. Settings →
 * Librarian and setup's Librarian step offer a copy for it. */
export function openedInPlaceVault(c: MemexConfig | undefined): MemexInstance | null {
  if (!c?.openedInPlace) return null;
  return c.currentFolder ?? c.instances.find((i) => i.id === CORPUS_INSTANCE_ID) ?? null;
}

/** Where a vault keeps its own chats and its storage (the role map's folders
 * in a brought-in vault). */
export const chatsDirOf = (i: MemexInstance): string => i.folderRoles?.chats ?? "chats";
export const storageDirOf = (i: MemexInstance): string => i.folderRoles?.storage ?? "storage";
