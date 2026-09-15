// Phase 2 — the corpus behind the seam. The SAME NotesService interface the
// UI has consumed since phase 1, now backed by plain files in the explicitly
// selected vault through the Rust corpus commands (src-tauri/src/corpus.rs).
// Only constructed inside the Tauri shell (the switch lives in ./notes.ts);
// the browser/dev surface keeps the in-memory service — the seam's whole point.

import {
  corpusCreate,
  corpusCreateFolder,
  corpusDelete,
  corpusList,
  corpusListConfig,
  corpusMove,
  corpusRead,
  corpusRenameManagedFile,
  corpusSearch,
  corpusWrite,
} from "../lib/tauri";
import type { NoteCreationPolicy } from "../security/secureNotes";
import type { Folder, Note, NoteSummary, SearchHit } from "../types";
import { snippetOf, titleOf } from "./derive";
import { DEST, isChats, isHidden, isRootMarker, isVault, memexMarkersOf } from "./destinations";
import type { NotesService } from "./notesPort";

/** corpus.rs says "note not found: <id>" for a stale/unknown id. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes("note not found");
}

const EMPTY_MARKERS: ReadonlySet<string> = new Set();

/** The ONE per-folder scoping rule, shared by `listNotes` and the note universe
 * so the single-fetch path and the per-folder path can never drift. Pure — no
 * IPC. `memex` is the memex-root marker set, consulted ONLY for the All-Notes
 * (no folderId) case; the scoped cases are pure prefix tests.
 *
 * • no folderId → All Notes: everything EXCEPT the hidden roots, the external
 *   Vault (browsed only via its own row), AND chats/ transcripts — in a memex
 *   layout chats/*.md are writable notes, but the Chat front owns them; letting
 *   them ride here was the "chats leak into All notes" bug. Layout-gated: a
 *   PLAIN root's folder named "chats" stays in.
 * • a ROOT MARKER ("vault:") → the whole external root (wiki/ + chats/), by prefix.
 * • a hidden root (Archive/Trash) → only its own subtree, nothing leaks elsewhere.
 * • any normal folder → its subtree, minus hidden (defensive). */
export function scopeCorpusNotes(
  notes: NoteSummary[],
  folderId: string | undefined,
  memex: ReadonlySet<string>,
): NoteSummary[] {
  if (!folderId) {
    return notes.filter((n) => !isHidden(n.folderId) && !isVault(n.folderId) && !isChats(n.folderId, memex));
  }
  if (isRootMarker(folderId)) {
    return notes.filter((n) => n.folderId.startsWith(folderId));
  }
  if (isHidden(folderId)) {
    return notes.filter((n) => n.folderId === folderId || n.folderId.startsWith(`${folderId}/`));
  }
  return notes.filter(
    (n) => !isHidden(n.folderId) && (n.folderId === folderId || n.folderId.startsWith(`${folderId}/`)),
  );
}

/** The MEMEX root markers used to distinguish Chat transcripts. Vault switches
 * are live, so this must resolve from current config instead of a session cache. */
export function memexRootMarkers(): Promise<ReadonlySet<string>> {
  return corpusListConfig().then(memexMarkersOf);
}

export class FsNotesService implements NotesService {
  async listFolders(): Promise<Folder[]> {
    const { folders } = await corpusList();
    return folders;
  }

  async createFolder(name: string, parentId: string | null = null): Promise<Folder> {
    return corpusCreateFolder(name, parentId);
  }

  // No UI calls these yet, and the corpus has no rename/delete-folder command —
  // they land with the folder-management phase. Failing loudly beats faking it.
  async updateFolder(id: string, name: string): Promise<Folder> {
    throw new Error(`folder rename is not in the corpus yet (${id} → ${name})`);
  }

  async deleteFolder(id: string): Promise<void> {
    throw new Error(`folder delete is not in the corpus yet (${id})`);
  }

  async listNotes(folderId?: string): Promise<NoteSummary[]> {
    const { notes } = await corpusList();
    // the All-Notes case is the only one that needs the memex markers (its
    // chats/ exclusion is layout-gated); every scoped case is a pure prefix test
    const memex = folderId ? EMPTY_MARKERS : await memexRootMarkers();
    return scopeCorpusNotes(notes, folderId, memex);
  }

  /** The WHOLE corpus, unfiltered — every note across every root (hidden roots,
   * the external Vault, chats/, binary files included). The single-fetch source
   * the note universe (services/hooks.ts) filters into its per-folder views
   * client-side, instead of walking corpus_list once per view. */
  async listAll(): Promise<NoteSummary[]> {
    const { notes } = await corpusList();
    return notes;
  }

  /** FULL-TEXT search — Rust walks + reads + matches (corpus_search), same
   * cost class as one corpus_list. Scope/ranking live on the Rust side. */
  async searchNotes(query: string, limit = 50): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    return corpusSearch(query, limit);
  }

  async getNote(id: string): Promise<Note | null> {
    if (!id) return null;
    try {
      const doc = await corpusRead(id);
      return {
        id: doc.id,
        title: titleOf(doc.body),
        snippet: snippetOf(doc.body),
        bodyEmpty: !doc.body.trim(),
        folderId: doc.folderId,
        diskFolderId: doc.diskFolderId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        pinned: doc.pinned,
        body: doc.body,
        revision: doc.revision,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async createNote(folderId: string, body: string, policy?: NoteCreationPolicy): Promise<Note> {
    const meta = await corpusCreate(folderId, body, policy);
    const doc = await corpusRead(meta.id);
    return { ...meta, body, revision: doc.revision };
  }

  async updateNote(id: string, body: string, expectedRevision: string, expectedBody?: string): Promise<Note> {
    try {
      // pinned is not part of the editor's write — Rust preserves the disk
      // truth itself, so no read-modify-write round-trip (or race) here
      const result = await corpusWrite(id, body, expectedRevision, expectedBody);
      return { ...result, body };
    } catch (err) {
      // the editor model evicts dead buffers on this exact message shape
      if (isNotFound(err)) throw new Error(`unknown note: ${id}`);
      throw err;
    }
  }

  async deleteNote(id: string): Promise<void> {
    await corpusDelete(id);
  }

  // ——— lifecycle: Rust's corpus_move keeps the id/index and bakes the origin
  // rule on disk; we read the body back so callers get a full Note (the move
  // meta carries no body), exactly like getNote derives (the maintainer, 2026-06-13). ———

  async moveNote(id: string, targetFolder: string): Promise<Note> {
    const meta = await corpusMove(id, targetFolder);
    const { body, revision } = await corpusRead(id);
    return {
      id: meta.id,
      title: titleOf(body),
      snippet: snippetOf(body),
      bodyEmpty: !body.trim(),
      ...(meta.aliases ? { aliases: meta.aliases } : {}),
      folderId: meta.folderId,
      diskFolderId: meta.diskFolderId,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      pinned: meta.pinned,
      body,
      revision,
    };
  }

  async archiveNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.archive);
  }

  async trashNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.trash);
  }

  async restoreNote(id: string): Promise<Note> {
    // Send it back where it came from. The origin breadcrumb is THREE-valued
    // (corpus.rs:162-167): absent (null) → never had a home, go to Inbox;
    // "" → the corpus ROOT (a distinct, deliberate value, NOT a miss);
    // a folder id → there if it still exists on disk, else Inbox. The empty
    // string is falsy AND the root is never present in the folder list, so it
    // MUST be matched explicitly — otherwise a root note silently lands in Inbox.
    const { origin } = await corpusRead(id);
    const { folders } = await corpusList();
    const target =
      origin == null
        ? DEST.inbox
        : origin === "" || folders.some((f) => f.id === origin)
          ? origin
          : DEST.inbox;
    return this.moveNote(id, target);
  }

  async renameFile(id: string, name: string): Promise<string> {
    return corpusRenameManagedFile(id, name);
  }
}
