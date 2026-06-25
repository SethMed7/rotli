// Phase 2 — the corpus behind the seam. The SAME NotesService interface the
// UI has consumed since phase 1, now backed by plain .md files in
// ~/Documents/rotli through the Rust corpus commands (src-tauri/src/corpus.rs).
// Only constructed inside the Tauri shell (the switch lives in ./notes.ts);
// the browser/dev surface keeps the in-memory service — the seam's whole point.

import {
  corpusCreate,
  corpusCreateFolder,
  corpusDelete,
  corpusList,
  corpusMove,
  corpusRead,
  corpusWrite,
} from "../lib/tauri";
import type { Folder, Note, NoteSummary } from "../types";
import { DEST, isHidden, isRootMarker, isVault } from "./destinations";
import { snippetOf, titleOf } from "./derive";
import type { NotesService } from "./notes";

/** corpus.rs says "note not found: <id>" for a stale/unknown id. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes("note not found");
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
    // All Notes (no folderId): everything EXCEPT the hidden roots AND the
    // external Vault — the Vault is browsed only via its own row, never mixed
    // into the local "All notes" pick.
    if (!folderId) return notes.filter((n) => !isHidden(n.folderId) && !isVault(n.folderId));
    // A non-default ROOT MARKER ("vault:") scopes to the whole external root —
    // its surfaced subtree (wiki/ + chats/) is everything prefixed with it.
    if (isRootMarker(folderId)) {
      return notes.filter((n) => n.folderId.startsWith(folderId));
    }
    // Asking for a hidden root (Archive/Trash) is the ONLY way to see it:
    // scope to that root's subtree and nothing leaks elsewhere.
    if (isHidden(folderId)) {
      return notes.filter(
        (n) => n.folderId === folderId || n.folderId.startsWith(`${folderId}/`),
      );
    }
    // Any normal folder: everything under it, minus hidden (defensive — a note
    // can't sit under both, but the exclusion is the single source of truth).
    return notes.filter(
      (n) =>
        !isHidden(n.folderId) &&
        (n.folderId === folderId || n.folderId.startsWith(`${folderId}/`)),
    );
  }

  async getNote(id: string): Promise<Note | null> {
    if (!id) return null;
    try {
      const doc = await corpusRead(id);
      return {
        id: doc.id,
        title: titleOf(doc.body),
        snippet: snippetOf(doc.body),
        folderId: doc.folderId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        pinned: doc.pinned,
        body: doc.body,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async createNote(folderId: string, body: string): Promise<Note> {
    const meta = await corpusCreate(folderId, body);
    return { ...meta, body };
  }

  async updateNote(id: string, body: string): Promise<Note> {
    try {
      // pinned is not part of the editor's write — read the disk truth so the
      // four-fact frontmatter never loses it under an external pin/unpin
      const { pinned } = await corpusRead(id);
      const meta = await corpusWrite(id, body, pinned);
      return { ...meta, body };
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
  // meta carries no body), exactly like getNote derives (Seth, 2026-06-13). ———

  async moveNote(id: string, targetFolder: string): Promise<Note> {
    const meta = await corpusMove(id, targetFolder);
    const { body } = await corpusRead(id);
    return {
      id: meta.id,
      title: titleOf(body),
      snippet: snippetOf(body),
      folderId: meta.folderId,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      pinned: meta.pinned,
      body,
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
}
