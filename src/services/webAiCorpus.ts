// Rotli Web: what a model may see of the browser-side vault. The Mac app
// answers these questions in Rust (corpus_notes_ai, corpus_search_ai,
// corpus_read_ai, corpus_readable_ids) with the secure-note law enforced
// there; on the web the same law is enforced here, over the notes service,
// and fails closed: a note is withheld from every model when it lives in a
// secure folder OR its body trips the secret detector. The web has no
// on-device models, so there is no local-class exception to enforce.

import { looksSecret } from "../ai/guard";
import type { CorpusNoteMeta, FrontmatterView, WebAiCorpus } from "../lib/tauri";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import type { NoteSummary, SearchHit } from "../types";
import type { NotesService } from "./notesPort";

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

/** The web's answer to the Rust read gate, over one notes service. */
export function createWebAiCorpus(notes: () => NotesService): WebAiCorpus {
  const secure = async (id: string): Promise<boolean> => {
    const note = await notes().getNote(id);
    if (!note) return true; // unknowable = withheld
    if (note.kind && note.kind !== "note") return false;
    return secureByLocation(note) || looksSecret(note.body);
  };
  const readableOnly = async <T extends { id: string }>(items: T[]): Promise<T[]> => {
    const verdicts = await Promise.all(items.map((item) => secure(item.id)));
    return items.filter((_, index) => !verdicts[index]);
  };
  return {
    async list(): Promise<CorpusNoteMeta[]> {
      const visible = (await notes().listNotes()).filter((n) => !n.kind || n.kind === "note");
      return (await readableOnly(visible)).map(meta);
    },
    async search(query: string, limit: number | undefined): Promise<SearchHit[]> {
      const hits = (await notes().searchNotes(query, limit)).filter((h) => h.kind === "note");
      return readableOnly(hits);
    },
    async read(id: string): Promise<{ body: string; revision: string }> {
      if (await secure(id)) throw new Error("This note is secure and never leaves this computer.");
      const note = await notes().getNote(id);
      if (!note) throw new Error("unknown note");
      return { body: note.body, revision: note.revision };
    },
    async readableIds(ids: string[]): Promise<string[]> {
      return (await readableOnly(ids.map((id) => ({ id })))).map((item) => item.id);
    },
    async frontmatter(id: string): Promise<FrontmatterView | null> {
      const note = await notes().getNote(id);
      if (!note) return null;
      const isSecure = await secure(id);
      return {
        id: note.id,
        created: new Date(note.createdAt).toISOString(),
        updated: new Date(note.updatedAt).toISOString(),
        locked: false,
        secure: isSecure,
        localAiAllowed: false,
        pinned: note.pinned,
        fields: [],
      };
    },
  };
}
