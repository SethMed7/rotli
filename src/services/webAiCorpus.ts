// Rotli Web: what a model may see of the browser-side vault. The Mac app
// answers these questions in Rust (corpus_notes_ai, corpus_search_ai,
// corpus_read_ai, corpus_readable_ids) with the secure-note law enforced
// there; on the web the same law is enforced here, over the notes service,
// and fails closed: a note is withheld from every model when it lives in a
// secure folder, OR its frontmatter says `secure: true`, OR its body trips
// the secret detector. The web has no on-device models, so there is no
// local-class exception to enforce.

import { looksSecret } from "../ai/guard";
import { bodyEditRefusal } from "../lib/aiEditPolicy";
import type { CorpusNoteMeta, CorpusWriteResult, FrontmatterView, WebAiCorpus } from "../lib/tauri";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import type { Note, NoteSummary, SearchHit } from "../types";
import type { NotesService } from "./notesPort";
import { searchMatch } from "./search";

function secureByLocation(note: Pick<NoteSummary, "folderId" | "diskFolderId">): boolean {
  const disk = note.diskFolderId ?? note.folderId;
  return isSecureNotesFolder(note.folderId) || isSecureBrainFolder(disk) || isSecureNotesFolder(disk);
}

function meta(note: NoteSummary): CorpusNoteMeta {
  return {
    id: note.id,
    title: note.title,
    snippet: note.snippet,
    ...(note.bodyEmpty === undefined ? {} : { bodyEmpty: note.bodyEmpty }),
    ...(note.aliases ? { aliases: note.aliases } : {}),
    folderId: note.folderId,
    diskFolderId: note.diskFolderId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    pinned: note.pinned,
    ...(note.kind ? { kind: note.kind } : {}),
  };
}

/** The web's answer to the Rust read gate, over one notes service.
 *
 * Every entry point decides AND answers from ONE `getNote` read (review of PR
 * #267, twice): a verdict on one answer and a body, row, or write from
 * another let a note that turned secure in between reach a model. A row is
 * built only from that judged note, never spread from a summary or a hit. */
export function createWebAiCorpus(notes: () => NotesService): WebAiCorpus {
  const secureNote = (note: Note): boolean =>
    (!note.kind || note.kind === "note") &&
    (note.secure === true || secureByLocation(note) || looksSecret(note.body));
  /** The one read: the note when a model may see it, else null. */
  const judged = async (id: string): Promise<Note | null> => {
    const note = await notes().getNote(id);
    return note && !secureNote(note) ? note : null;
  };
  /** The one read for an entry point that must say why it refuses. */
  const readable = async (id: string): Promise<Note> => {
    const note = await notes().getNote(id);
    if (!note) throw new Error("unknown note");
    if (secureNote(note)) throw new Error("This note is secure and never leaves this computer.");
    return note;
  };
  const hitOf = (note: Note, query: string): SearchHit | null => {
    const match = searchMatch(query, note.title, note.body, note.snippet);
    if (!match) return null;
    return {
      id: note.id,
      title: note.title,
      folderId: note.folderId,
      kind: "note",
      updatedAt: note.updatedAt,
      ...match,
    };
  };
  return {
    async list(): Promise<CorpusNoteMeta[]> {
      const visible = (await notes().listNotes()).filter((n) => !n.kind || n.kind === "note");
      const read = await Promise.all(visible.map((n) => judged(n.id)));
      return read.flatMap((note) => (note ? [meta(note)] : []));
    },
    async search(query: string, limit: number | undefined): Promise<SearchHit[]> {
      const hits = (await notes().searchNotes(query, limit)).filter((h) => h.kind === "note");
      const read = await Promise.all(hits.map((h) => judged(h.id)));
      return read.flatMap((note) => {
        const hit = note && hitOf(note, query);
        return hit ? [hit] : [];
      });
    },
    async read(id: string): Promise<{ body: string; revision: string }> {
      const note = await readable(id);
      return { body: note.body, revision: note.revision };
    },
    async readableIds(ids: string[]): Promise<string[]> {
      const read = await Promise.all(ids.map((id) => judged(id)));
      return ids.filter((_, index) => read[index] !== null);
    },
    async write(id: string, body: string, expectedRevision: string): Promise<CorpusWriteResult> {
      // the web twin of corpus_write_ai: read gate, then who may rewrite the
      // text (locked, the grant, provenance), then no secret into an open note;
      // all on the one read whose revision the write must still match
      const note = await readable(id);
      if (note.revision !== expectedRevision)
        throw new Error("The note changed since it was read. Read it again before editing.");
      const refusal = bodyEditRefusal(
        note.locked === true ? "locked" : (note.aiBodyEdit ?? "person-written"),
      );
      if (refusal) throw new Error(refusal);
      if (looksSecret(body))
        throw new Error("This text looks like it holds a secret, so it can't be written into an open note.");
      const saved = await notes().updateNote(id, body, expectedRevision);
      return { ...meta(saved), revision: saved.revision };
    },
    async frontmatter(id: string): Promise<FrontmatterView | null> {
      const note = await notes().getNote(id);
      if (!note) return null;
      return {
        id: note.id,
        created: new Date(note.createdAt).toISOString(),
        updated: new Date(note.updatedAt).toISOString(),
        locked: note.locked === true,
        secure: secureNote(note),
        localAiAllowed: false,
        pinned: note.pinned,
        // an adapter that doesn't read provenance answers fail-closed
        aiBodyEdit: note.locked === true ? "locked" : (note.aiBodyEdit ?? "person-written"),
        fields: [],
      };
    },
  };
}
