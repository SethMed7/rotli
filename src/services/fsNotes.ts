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
  corpusRead,
  corpusWrite,
} from "../lib/tauri";
import type { Folder, Note, NoteSummary } from "../types";
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
    if (!folderId) return notes;
    // one mental model: a folder holds everything under it — ids are paths
    return notes.filter(
      (n) => n.folderId === folderId || n.folderId.startsWith(`${folderId}/`),
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
}
