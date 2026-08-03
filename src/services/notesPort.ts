import type { NoteCreationPolicy } from "../security/secureNotes";
import type { Folder, Note, NoteSummary, SearchHit } from "../types";

/** Application-facing note access. Implementations live in adapters; callers
 * depend on this port rather than the browser or filesystem implementation. */
export interface NotesService {
  listFolders(): Promise<Folder[]>;
  createFolder(name: string, parentId?: string | null): Promise<Folder>;
  updateFolder(id: string, name: string): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  /** No folderId means all visible notes; a folder includes descendants. */
  listNotes(folderId?: string): Promise<NoteSummary[]>;
  /** The WHOLE corpus, unfiltered (hidden roots, Vault, chats/, files included).
   * The single-fetch source the note universe filters into its per-folder views
   * client-side, instead of listing once per view. */
  listAll(): Promise<NoteSummary[]>;
  /** Full-text title/body search. Trust-boundary filtering remains independent
   * in the filesystem/Rust adapter and AI host. */
  searchNotes(query: string, limit?: number): Promise<SearchHit[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(folderId: string, body: string, policy?: NoteCreationPolicy): Promise<Note>;
  updateNote(id: string, body: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  /** Lifecycle moves preserve identity; restore applies the durable origin
   * rule and falls back to Inbox when the former home no longer exists. */
  moveNote(id: string, targetFolder: string): Promise<Note>;
  archiveNote(id: string): Promise<Note>;
  trashNote(id: string): Promise<Note>;
  restoreNote(id: string): Promise<Note>;
}
