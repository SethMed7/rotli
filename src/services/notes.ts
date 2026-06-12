// The data seam. All note/folder access goes through this typed interface —
// today it is in-memory (reload wipes everything; correct for Stage 1), later
// phases swap the implementation for the markdown corpus without touching UI.

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface NoteSummary {
  id: string;
  title: string;
  folderId: string;
  updatedAt: number;
}

export interface Note extends NoteSummary {
  body: string;
}

export interface NotesService {
  listFolders(): Promise<Folder[]>;
  listNotes(folderId?: string): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(folderId: string, body: string): Promise<Note>;
  updateNote(id: string, body: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
}

function titleOf(body: string): string {
  return body.split("\n", 1)[0]?.replace(/^#+\s*/, "").trim() || "Untitled";
}

export class InMemoryNotesService implements NotesService {
  private folders = new Map<string, Folder>();
  private notes = new Map<string, Note>();
  private nextId = 1;

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  async listFolders(): Promise<Folder[]> {
    return [...this.folders.values()];
  }

  async listNotes(folderId?: string): Promise<NoteSummary[]> {
    const all = [...this.notes.values()];
    const inFolder = folderId ? all.filter((n) => n.folderId === folderId) : all;
    return inFolder
      .map(({ body: _body, ...summary }) => summary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getNote(id: string): Promise<Note | null> {
    return this.notes.get(id) ?? null;
  }

  async createNote(folderId: string, body: string): Promise<Note> {
    const note: Note = {
      id: this.id("note"),
      title: titleOf(body),
      folderId,
      updatedAt: Date.now(),
      body,
    };
    this.notes.set(note.id, note);
    return note;
  }

  async updateNote(id: string, body: string): Promise<Note> {
    const existing = this.notes.get(id);
    if (!existing) throw new Error(`unknown note: ${id}`);
    const updated: Note = { ...existing, body, title: titleOf(body), updatedAt: Date.now() };
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: string): Promise<void> {
    this.notes.delete(id);
  }
}

export const notesService: NotesService = new InMemoryNotesService();
