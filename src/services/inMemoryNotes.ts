// The in-memory NotesService — the browser twin's data model and Rotli
// Web's, persisted by ./webNotes.ts. It mirrors the Rust corpus rules the UI
// depends on (reserved folder ids, the three-valued restore origin, the
// rename refusal, the vault read-only ceiling) so the same components behave
// the same off-disk. ./notes.ts owns the switch between this and the disk.

import { extOf, fileName, userFileName } from "../lib/fileKind";
import { noteSlugify, ulid } from "../memex/contract";
import type { NoteCreationPolicy } from "../security/secureNotes";
import type { Folder, Note, NoteSummary, SearchHit } from "../types";
import { snippetOf, summaryOrder, titleOf } from "./derive";
import { DEST, isChats, isHidden, isRootMarker, isSink, isTrash, isVault } from "./destinations";
import type { NotesService } from "./notesPort";
import { searchMatch, sortHits } from "./search";

/** The browser world's memex roots: the seeded corpus is a PLAIN local root
 * (Inbox/Storage/…), and the one memex is the seeded Vault brain — so only
 * "vault:chats/…" counts as Chat-front transcripts here, exactly like fs mode
 * with a plain corpus + a connected brain. */
const MEMEX_MARKERS: ReadonlySet<string> = new Set([DEST.vault]);

export { ulid };

/** The browser vault's serialized form of the in-memory service (version 1).
 * Unknown future versions are refused at hydration, never stamped down. */
export interface NotesSnapshot {
  version: 1;
  folders: Folder[];
  notes: Note[];
  origins: Record<string, string>;
  revisionCounter: number;
}

export function isNotesSnapshot(value: unknown): value is NotesSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    Array.isArray(v.folders) &&
    Array.isArray(v.notes) &&
    typeof v.origins === "object" &&
    v.origins !== null &&
    typeof v.revisionCounter === "number"
  );
}

export class InMemoryNotesService implements NotesService {
  private folders = new Map<string, Folder>();
  private notes = new Map<string, Note>();
  private revisionCounter = 0;

  private nextRevision(): string {
    this.revisionCounter += 1;
    return `memory:${this.revisionCounter}`;
  }
  /** Where an archived/trashed note came from, so Phase 2 restore is
   * reviewable in the browser surface — fs mode carries this on disk instead.
   * Side Map keeps Note's shape identical to the FS service (the maintainer, 2026-06-13). */
  readonly origins = new Map<string, string>();

  async listFolders(): Promise<Folder[]> {
    return [...this.folders.values()];
  }

  async createFolder(name: string, parentId: string | null = null): Promise<Folder> {
    // a RESERVED parent (id === its path, seedReserved) gets a path-style
    // child id, mirroring fs mode where folderId === the relative path — the
    // System browser's folder seeding depends on that grammar
    const parent = parentId ? this.folders.get(parentId) : null;
    if (parentId && !parent) throw new Error(`no folder ${parentId}`);
    const pathStyle = parent && (parent.id.includes("/") || parent.id === parent.name);
    const folder: Folder = pathStyle
      ? { id: `${parentId}/${name}`, name, parentId }
      : // a top-level folder is its own path too (fs mode: folderId === the
        // relative path), unless that name is already taken — then a ulid,
        // exactly as before, so nothing that seeds by ulid changes shape
        { id: this.folders.has(name) ? ulid() : name, name, parentId };
    this.folders.set(folder.id, folder);
    return folder;
  }

  async updateFolder(id: string, name: string): Promise<Folder> {
    const existing = this.folders.get(id);
    if (!existing) throw new Error(`unknown folder: ${id}`);
    const updated = { ...existing, name };
    this.folders.set(id, updated);
    return updated;
  }

  async deleteFolder(id: string): Promise<void> {
    this.folders.delete(id);
  }

  private descendants(folderId: string): Set<string> {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.folders.values()) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  async listNotes(folderId?: string): Promise<NoteSummary[]> {
    const all = [...this.notes.values()];
    // Same three-case rule as FsNotesService (destinations.ts is the truth):
    // All Notes hides the hidden roots; a hidden root shows only its subtree;
    // any normal folder shows its subtree minus hidden (defensive).
    // A non-default ROOT MARKER ("vault:") scopes to the whole external root by
    // id prefix (its folders aren't in the descendants() parent-graph). Handle it
    // before the parent-graph cases so the browser mirror matches fs mode.
    if (folderId && isRootMarker(folderId)) {
      return all
        .filter((n) => n.folderId.startsWith(folderId))
        .map(({ body: _body, ...summary }) => summary)
        .sort(summaryOrder);
    }
    const within = folderId ? this.descendants(folderId) : null; // once, not per note
    let scoped: Note[];
    // All Notes also excludes the external Vault (browsed only via its own row)
    // AND chats/ transcripts — the Chat front owns those (the fs twin agrees).
    if (!within)
      scoped = all.filter(
        (n) => !isHidden(n.folderId) && !isVault(n.folderId) && !isChats(n.folderId, MEMEX_MARKERS),
      );
    else if (folderId && isHidden(folderId)) scoped = all.filter((n) => within.has(n.folderId));
    else scoped = all.filter((n) => within.has(n.folderId) && !isHidden(n.folderId));
    return scoped.map(({ body: _body, ...summary }) => summary).sort(summaryOrder);
  }

  /** The WHOLE corpus, unfiltered — the browser twin of the fs adapter's
   * single-fetch source for the note universe. Order is irrelevant (the universe
   * filters into per-folder views); no sort. */
  async listAll(): Promise<NoteSummary[]> {
    return [...this.notes.values()].map(({ body: _body, ...summary }) => summary);
  }

  /** The browser twin of Rust corpus_search: same scope (never Trash, never
   * chats/ — Archive/staged/Vault stay findable), same pure grammar
   * (search.ts searchMatch/sortHits), same cap. In-memory notes are all
   * kind:"note", so no board/binary filter is needed here. */
  async searchNotes(query: string, limit = 50): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    const hits: SearchHit[] = [];
    for (const n of this.notes.values()) {
      if (isTrash(n.folderId) || isChats(n.folderId, MEMEX_MARKERS)) continue;
      const m = searchMatch(query, n.title, n.body, n.snippet);
      if (!m) continue;
      hits.push({
        id: n.id,
        title: n.title,
        snippet: m.snippet,
        folderId: n.folderId,
        kind: n.kind ?? "note",
        rank: m.rank,
        matchStart: m.matchStart,
        matchLen: m.matchLen,
        spans: m.spans,
        updatedAt: n.updatedAt,
      });
    }
    return sortHits(hits).slice(0, limit);
  }

  async getNote(id: string): Promise<Note | null> {
    return this.notes.get(id) ?? null;
  }

  async createNote(folderId: string, body: string, _policy?: NoteCreationPolicy): Promise<Note> {
    // mirror fs mode's safety ceiling: rotli never creates a note inside the
    // external Vault (the memex is read-mostly; corpus_create's writable() gate
    // refuses it in the shell). Keeps the browser preview honest.
    if (isVault(folderId)) throw new Error("the Vault is read-only — notes can't be created there");
    const now = Date.now();
    const note: Note = {
      id: ulid(now),
      title: titleOf(body),
      snippet: snippetOf(body),
      bodyEmpty: !body.trim(),
      aliases: [noteSlugify(titleOf(body))],
      folderId,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      body,
      revision: this.nextRevision(),
    };
    this.notes.set(note.id, note);
    return note;
  }

  async updateNote(id: string, body: string, expectedRevision: string, expectedBody?: string): Promise<Note> {
    const existing = this.notes.get(id);
    if (!existing) throw new Error(`unknown note: ${id}`);
    if (!expectedRevision || (expectedRevision !== existing.revision && expectedBody !== existing.body)) {
      throw new Error(
        `revision conflict: expected ${expectedRevision || "(missing)"}, found ${existing.revision}; the note changed after it was opened`,
      );
    }
    const title = titleOf(body);
    const aliases = [...(existing.aliases ?? [])];
    if (existing.title !== title) {
      for (const alias of [existing.title, noteSlugify(existing.title), noteSlugify(title)]) {
        if (alias && !aliases.some((value) => value.toLocaleLowerCase() === alias.toLocaleLowerCase())) {
          aliases.push(alias);
        }
      }
    }
    const updated: Note = {
      ...existing,
      body,
      title,
      aliases,
      snippet: snippetOf(body),
      bodyEmpty: !body.trim(),
      updatedAt: Date.now(),
      revision: this.nextRevision(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: string): Promise<void> {
    this.notes.delete(id);
  }

  // ——— lifecycle: move keeps the note's id; only its folderId changes. The
  // origin Map mirrors fs mode's on-disk breadcrumb so restore is reviewable in
  // the browser surface, while the Note's shape stays identical to fs mode —
  // origin is NEVER a field on Note (the maintainer, 2026-06-13). ———

  async moveNote(id: string, targetFolder: string): Promise<Note> {
    const existing = this.notes.get(id);
    if (!existing) throw new Error(`unknown note: ${id}`);
    // mirror Rust's cross-root refusal: a note can't move into the external
    // Vault (or out of it, but that path can't arise in browser mode).
    if (isVault(targetFolder)) throw new Error("moving a note into the Vault isn't supported");
    const from = existing.folderId;
    // The SAME origin rule Rust bakes in (isSink mirrors Rust is_hidden_root —
    // Archive/Trash only, NOT Board): entering a sink from a non-sink folder
    // records where it came from; leaving a sink when an origin exists clears
    // it; otherwise the breadcrumb is left untouched.
    if (isSink(targetFolder) && !isSink(from)) this.origins.set(id, from);
    else if (!isSink(targetFolder) && this.origins.has(id)) this.origins.delete(id);
    const updated: Note = { ...existing, folderId: targetFolder };
    this.notes.set(id, updated);
    return updated;
  }

  async archiveNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.archive);
  }

  async trashNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.trash);
  }

  async restoreNote(id: string): Promise<Note> {
    // Mirror fs mode's three-valued origin (corpus.rs:162-167): no breadcrumb →
    // Inbox; "" → the corpus ROOT (a distinct value, NOT a miss); a folder id →
    // there if it still exists, else Inbox. "" is falsy and no folder has id "",
    // so the root case must be matched explicitly.
    const origin = this.origins.get(id);
    const target =
      origin === undefined ? DEST.inbox : origin === "" || this.folders.has(origin) ? origin : DEST.inbox;
    return this.moveNote(id, target);
  }

  /** The browser twin of corpus_rename_managed_file: same filename rule, same
   * refusal of a taken name. */
  async renameFile(id: string, name: string): Promise<string> {
    const file = this.notes.get(id);
    if (!file || file.kind !== "file") throw new Error(`file not found: ${id}`);
    const next = userFileName(name, extOf(fileName(id)));
    const folder = id.includes("/") ? id.slice(0, id.lastIndexOf("/") + 1) : "";
    const newId = `${folder}${next}`;
    if (newId === id) return id;
    if (newId.toLowerCase() !== id.toLowerCase() && this.notes.has(newId))
      throw new Error(`a file named “${next}” already exists here`);
    this.notes.delete(id);
    this.notes.set(newId, { ...file, id: newId, title: next, revision: this.nextRevision() });
    return newId;
  }

  /** A surfaced binary row (id = its path, title = its filename) — lets browser
   * specs exercise file menus without a filesystem. */
  seedFile(id: string, folderId: string = DEST.storage): Note {
    const now = Date.now();
    const file: Note = {
      id,
      title: fileName(id),
      snippet: "",
      bodyEmpty: false,
      folderId,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      kind: "file",
      body: "",
      revision: this.nextRevision(),
    };
    this.notes.set(id, file);
    return file;
  }

  /** Everything the service holds, as plain data: Rotli Web persists this to
   * the browser vault and restores it on the next visit. Revisions continue
   * from the counter so a tab restored after reload cannot present a stale
   * revision that happens to match a fresh one. */
  exportSnapshot(): NotesSnapshot {
    return {
      version: 1,
      folders: [...this.folders.values()],
      notes: [...this.notes.values()],
      origins: Object.fromEntries(this.origins),
      revisionCounter: this.revisionCounter,
    };
  }

  /** Replace the whole state with a snapshot (the inverse of exportSnapshot).
   * Anything seeded before this call is discarded; callers hydrate before
   * the first render, never over live edits. */
  importSnapshot(snapshot: NotesSnapshot): void {
    this.folders = new Map(snapshot.folders.map((folder) => [folder.id, folder]));
    this.notes = new Map(snapshot.notes.map((note) => [note.id, note]));
    this.origins.clear();
    for (const [id, origin] of Object.entries(snapshot.origins)) this.origins.set(id, origin);
    this.revisionCounter = Math.max(this.revisionCounter, snapshot.revisionCounter);
  }

  /** Synchronous seeding (Stage 1 sample corpus — the r1/r2 gate frames). */
  seedFolder(name: string, parentId: string | null = null): Folder {
    const folder: Folder = { id: ulid(), name, parentId };
    this.folders.set(folder.id, folder);
    return folder;
  }

  /** A reserved/destination folder whose id IS its name (or its path under a
   * reserved root, e.g. "Storage/Work", or a prefixed external-root path like
   * "vault:wiki") — matching fs mode where folderId === the relative path (bare
   * for the default root, "<rootid>:rel" for a non-default one). This is what
   * makes DEST.inbox === folder.id true in BOTH modes; the freshest-note and
   * destination lookups depend on it. */
  seedReserved(id: string, name: string, parentId: string | null = null): Folder {
    const folder: Folder = { id, name, parentId };
    this.folders.set(folder.id, folder);
    return folder;
  }

  seedNote(
    folderId: string,
    body: string,
    opts: { id?: string; pinned?: boolean; createdAt: number; updatedAt: number; origin?: string },
  ): Note {
    const note: Note = {
      id: opts.id ?? ulid(opts.createdAt),
      title: titleOf(body),
      snippet: snippetOf(body),
      bodyEmpty: !body.trim(),
      aliases: [noteSlugify(titleOf(body))],
      folderId,
      createdAt: opts.createdAt,
      updatedAt: opts.updatedAt,
      pinned: opts.pinned ?? false,
      body,
      revision: this.nextRevision(),
    };
    this.notes.set(note.id, note);
    if (opts.origin) this.origins.set(note.id, opts.origin);
    return note;
  }
}

// ——— the seeded corpus (titles/snippets from the approved gate frames) ———
// Browser/dev surface ONLY: inside the Tauri shell the demo corpus never even
// exists in memory — the disk corpus (with its one welcome note) is the truth.
