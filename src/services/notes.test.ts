// The in-memory NotesService is the browser/dev mirror of the Rust corpus.
// These lock the invariants both implementations share: ulid time-ordering,
// the three-case descendant scoping, the pinned→updatedAt→id sort (the
// SP-2/TSP-4 id tiebreak), and the origin breadcrumb rule across the
// archive/trash/restore lifecycle.

import { describe, expect, test } from "bun:test";

import { DEST } from "./destinations";
import { scopeCorpusNotes } from "./fsNotes";
import { InMemoryNotesService, ulid } from "./notes";

// A fresh service seeded with the local reserved roots + two nested Storage
// folders, mirroring how the browser surface is built (ids ARE paths). Storage
// stands in for any everyday local destination (it replaced the old Brain row
// after the Brain→Vault rename — the external Vault is browse-only, so it's a
// poor stand-in for a writable everyday folder).
function freshService(): InMemoryNotesService {
  const svc = new InMemoryNotesService();
  svc.seedReserved(DEST.inbox, DEST.inbox);
  svc.seedReserved(DEST.storage, DEST.storage);
  svc.seedReserved(DEST.archive, DEST.archive);
  svc.seedReserved(DEST.trash, DEST.trash);
  svc.seedReserved(`${DEST.storage}/Work`, "Work", DEST.storage);
  svc.seedReserved(`${DEST.storage}/Northstar`, "Northstar", DEST.storage);
  return svc;
}

describe("ulid", () => {
  test("is 26 chars of Crockford base32", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("sorts lexicographically by the time prefix (later time → larger id)", () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(2_000_000_000_000);
    expect(early < late).toBe(true);
  });

  test("differs in the random tail for the same timestamp", () => {
    const t = 1_700_000_000_000;
    // sharing a prefix, the 16-char random tail makes collisions effectively nil
    expect(ulid(t)).not.toBe(ulid(t));
  });
});

describe("createNote / getNote / updateNote", () => {
  test("derives title + snippet, stamps created==updated, defaults unpinned", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# Hello\n\nFirst body line.");
    expect(note.title).toBe("Hello");
    expect(note.snippet).toBe("First body line.");
    expect(note.folderId).toBe(DEST.inbox);
    expect(note.pinned).toBe(false);
    expect(note.createdAt).toBe(note.updatedAt);
    expect(note.body).toBe("# Hello\n\nFirst body line.");
  });

  test("round-trips through getNote, returns null for a miss", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# Hi");
    expect(await svc.getNote(note.id)).toEqual(note);
    expect(await svc.getNote("nope")).toBeNull();
  });

  test("re-derives title/snippet and bumps updatedAt on update", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# Before");
    const updated = await svc.updateNote(note.id, "# After\n\nnew body", note.revision);
    expect(updated.title).toBe("After");
    expect(updated.snippet).toBe("new body");
    expect(updated.createdAt).toBe(note.createdAt); // created never moves
    expect(updated.updatedAt).toBeGreaterThanOrEqual(note.updatedAt);
    expect(updated.id).toBe(note.id); // id is the through-line
  });

  test("throws a recognizable 'unknown note' error on a missing update", async () => {
    const svc = freshService();
    expect(svc.updateNote("ghost", "x", "memory:missing")).rejects.toThrow("unknown note: ghost");
  });

  test("refuses a stale whole-body update", async () => {
    const svc = freshService();
    const opened = await svc.createNote(DEST.inbox, "# Original");
    const external = await svc.updateNote(opened.id, "# External", opened.revision);
    await expect(svc.updateNote(opened.id, "# Stale", opened.revision)).rejects.toThrow("revision conflict");
    expect(await svc.getNote(opened.id)).toEqual(external);
  });

  test("merges a stale complete-file revision when the editor body stayed the same", async () => {
    const svc = freshService();
    const opened = await svc.createNote(DEST.inbox, "# Original");
    const metadataOnly = await svc.updateNote(opened.id, opened.body, opened.revision);
    expect(metadataOnly.revision).not.toBe(opened.revision);

    const merged = await svc.updateNote(opened.id, "# Local draft", opened.revision, opened.body);
    expect(merged.body).toBe("# Local draft");
  });
});

describe("listNotes — three-case descendant scoping", () => {
  test("All Notes (no folderId) excludes the hidden roots", async () => {
    const svc = freshService();
    await svc.createNote(DEST.inbox, "# visible inbox");
    await svc.createNote(`${DEST.storage}/Work`, "# visible nested");
    await svc.createNote(DEST.archive, "# archived");
    await svc.createNote(DEST.trash, "# trashed");

    const all = await svc.listNotes();
    const titles = all.map((n) => n.title).sort();
    expect(titles).toEqual(["visible inbox", "visible nested"]);
  });

  test("a normal folder includes its descendants (a folder holds everything under it)", async () => {
    const svc = freshService();
    await svc.createNote(DEST.storage, "# top brain");
    await svc.createNote(`${DEST.storage}/Work`, "# under work");
    await svc.createNote(`${DEST.storage}/Northstar`, "# under northstar");
    await svc.createNote(DEST.inbox, "# elsewhere");

    const inBrain = await svc.listNotes(DEST.storage);
    const titles = inBrain.map((n) => n.title).sort();
    expect(titles).toEqual(["top brain", "under northstar", "under work"]);
  });

  test("a hidden root shows ONLY its own subtree (and is allowed to)", async () => {
    const svc = freshService();
    await svc.createNote(DEST.archive, "# archived note");
    await svc.createNote(DEST.inbox, "# normal note");

    const archived = await svc.listNotes(DEST.archive);
    expect(archived.map((n) => n.title)).toEqual(["archived note"]);
  });

  test("scopes by the folder TREE (a note's folder must be a real descendant)", async () => {
    // descendants walks parentId — only a seeded child counts. A note in an
    // unseeded "Storage/x" path is NOT reachable from Storage and stays out.
    const svc = freshService();
    svc.seedReserved(`${DEST.storage}/Refs`, "Refs", DEST.storage);
    await svc.createNote(DEST.storage, "# kept");
    await svc.createNote(`${DEST.storage}/Refs`, "# also kept"); // real child
    await svc.createNote(`${DEST.storage}/ghost`, "# orphan path"); // no such folder
    const inStorage = await svc.listNotes(DEST.storage);
    expect(inStorage.map((n) => n.title).sort()).toEqual(["also kept", "kept"]);
  });
});

describe("listNotes — pinned → updatedAt → id sort (SP-2/TSP-4 tiebreak)", () => {
  test("pins float to the top, then newest, then id ascending on a tie", async () => {
    const svc = freshService();
    // two notes with the SAME updatedAt to force the id tiebreak; explicit,
    // controlled ids make the lock DETERMINISTIC (a random ulid tail would make
    // the assertion a coin-flip). "tie-AAAA" < "tie-BBBB", and tie A is seeded
    // SECOND — so if the tiebreak were removed, the stable sort would keep
    // insertion order (B before A) and this test would fail.
    svc.seedNote(DEST.inbox, "# tie B", { id: "tie-BBBB", createdAt: 100, updatedAt: 100 });
    svc.seedNote(DEST.inbox, "# tie A", { id: "tie-AAAA", createdAt: 100, updatedAt: 100 });
    svc.seedNote(DEST.inbox, "# newest", { createdAt: 300, updatedAt: 300 });
    svc.seedNote(DEST.inbox, "# pinned old", { pinned: true, createdAt: 50, updatedAt: 50 });

    const rows = await svc.listNotes(DEST.inbox);
    // pinned first regardless of age
    expect(rows[0]?.title).toBe("pinned old");
    // then newest by updatedAt
    expect(rows[1]?.title).toBe("newest");
    // then the equal-updatedAt pair, broken by id ascending: tie A before tie B
    const ia = rows.findIndex((n) => n.title === "tie A");
    const ib = rows.findIndex((n) => n.title === "tie B");
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ia).toBeLessThan(ib);
  });

  test("summaries carry no body field", async () => {
    const svc = freshService();
    await svc.createNote(DEST.inbox, "# has body\n\nsecret");
    const [row] = await svc.listNotes(DEST.inbox);
    expect(row).toBeDefined();
    expect("body" in (row as object)).toBe(false);
  });
});

describe("moveNote + the origin breadcrumb rule", () => {
  test("entering a hidden root from a normal folder records the origin", async () => {
    const svc = freshService();
    const note = await svc.createNote(`${DEST.storage}/Work`, "# a thought");
    expect(svc.origins.has(note.id)).toBe(false);

    const archived = await svc.archiveNote(note.id);
    expect(archived.folderId).toBe(DEST.archive);
    expect(archived.id).toBe(note.id); // id preserved through the move
    expect(svc.origins.get(note.id)).toBe(`${DEST.storage}/Work`);
  });

  test("restore reads the breadcrumb, lands the note home, and CLEARS the origin", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.storage, "# keep this");
    await svc.archiveNote(note.id);
    expect(svc.origins.get(note.id)).toBe(DEST.storage);

    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(DEST.storage);
    expect(svc.origins.has(note.id)).toBe(false); // breadcrumb dropped — it's home now
  });

  test("restore falls back to Inbox when the origin folder is gone", async () => {
    const svc = freshService();
    const note = await svc.createNote(`${DEST.storage}/Work`, "# orphan");
    await svc.trashNote(note.id);
    await svc.deleteFolder(`${DEST.storage}/Work`); // its home disappears
    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(DEST.inbox);
  });

  test("restore falls back to Inbox when there is no breadcrumb at all", async () => {
    const svc = freshService();
    // a note that lives directly in Trash with no recorded origin
    const note = svc.seedNote(DEST.trash, "# no origin", { createdAt: 1, updatedAt: 1 });
    expect(svc.origins.has(note.id)).toBe(false);
    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(DEST.inbox);
  });

  test("restore of a root-origin note returns it to the corpus root, not Inbox (TSP-3)", async () => {
    // a note that lived at the bare corpus root (folderId "") records origin ""
    // when archived — a value DISTINCT from "no breadcrumb" (corpus.rs:162-167).
    const svc = freshService();
    const note = await svc.createNote("", "# loose at root");
    await svc.archiveNote(note.id);
    expect(svc.origins.get(note.id)).toBe(""); // the root breadcrumb, not undefined
    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(""); // back to the root, NOT DEST.inbox
    expect(svc.origins.has(note.id)).toBe(false); // breadcrumb cleared — it's home
  });

  test("an archived note still EXISTS via getNote (the pruneQuick premise — SP-1)", async () => {
    // archive/trash are id-preserving MOVES, not deletions: getNote must still
    // find the note, so Quick-note pruning never treats an archived note as gone
    // even though All-Notes hides it.
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# keep me in quick");
    await svc.archiveNote(note.id);
    expect(await svc.getNote(note.id)).not.toBeNull();
    const allIds = (await svc.listNotes()).map((n) => n.id);
    expect(allIds).not.toContain(note.id); // hidden from All Notes — why prune can't use it
  });

  test("a plain visible→visible move never stamps an origin", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# moving around");
    await svc.moveNote(note.id, DEST.storage);
    expect(svc.origins.has(note.id)).toBe(false);
    expect((await svc.getNote(note.id))?.folderId).toBe(DEST.storage);
  });

  test("hidden→hidden keeps the existing breadcrumb untouched", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.storage, "# from brain");
    await svc.trashNote(note.id); // origin = Brain
    expect(svc.origins.get(note.id)).toBe(DEST.storage);
    await svc.moveNote(note.id, DEST.archive); // hidden → hidden
    expect(svc.origins.get(note.id)).toBe(DEST.storage); // unchanged
  });

  test("archiveNote/trashNote land in their reserved roots", async () => {
    const svc = freshService();
    const a = await svc.createNote(DEST.inbox, "# one");
    const b = await svc.createNote(DEST.inbox, "# two");
    expect((await svc.archiveNote(a.id)).folderId).toBe(DEST.archive);
    expect((await svc.trashNote(b.id)).folderId).toBe(DEST.trash);
  });

  test("throws on moving an unknown note", async () => {
    const svc = freshService();
    expect(svc.moveNote("ghost", DEST.storage)).rejects.toThrow("unknown note: ghost");
  });
});

describe("the external Vault root (Track 2) — browse-only, prefix-scoped", () => {
  // mirror fs mode: the Vault root's surfaced folders carry the "vault:" prefix
  // and parentId === null (Rust aggregates its top-level folders with no parent).
  function withVault(): InMemoryNotesService {
    const svc = freshService();
    svc.seedReserved("vault:wiki", "wiki", null);
    svc.seedReserved("vault:chats", "chats", null);
    svc.seedReserved("vault:wiki/projects", "projects", "vault:wiki");
    return svc;
  }

  // vault notes are SEEDED (read-only, like reading them off ~/memex-vault on disk) —
  // createNote REFUSES the vault (the write ceiling), so populate them directly.
  const TS = 1_700_000_000_000;
  const seedVault = (svc: InMemoryNotesService, folderId: string, body: string) =>
    svc.seedNote(folderId, body, { createdAt: TS, updatedAt: TS });

  test("the ROOT MARKER 'vault:' scopes to everything under the external root", async () => {
    const svc = withVault();
    seedVault(svc, "vault:wiki", "# a wiki note");
    seedVault(svc, "vault:wiki/projects", "# a project note");
    seedVault(svc, "vault:chats", "# a chat note");
    await svc.createNote(DEST.inbox, "# a local note");

    const inVault = await svc.listNotes(DEST.vault);
    const titles = inVault.map((n) => n.title).sort();
    expect(titles).toEqual(["a chat note", "a project note", "a wiki note"]);
  });

  test("All Notes EXCLUDES the Vault — it's browsed only via its own row", async () => {
    const svc = withVault();
    await svc.createNote(DEST.inbox, "# local visible");
    seedVault(svc, "vault:wiki", "# vault hidden from all-notes");

    const titles = (await svc.listNotes()).map((n) => n.title).sort();
    expect(titles).toEqual(["local visible"]);
  });

  test("refuses to create or move a note into the Vault (the write ceiling)", async () => {
    const svc = withVault();
    expect(svc.createNote("vault:wiki", "# nope")).rejects.toThrow();
    const local = await svc.createNote(DEST.inbox, "# local");
    expect(svc.moveNote(local.id, "vault:wiki")).rejects.toThrow();
  });
});

// The note universe (services/hooks.ts) used to walk corpus_list once PER view
// (7+ IPC serializations per invalidation); it now fetches the whole corpus ONCE
// (listAll) and derives each view client-side with scopeCorpusNotes — the SAME
// scope rule listNotes uses. These lock the equivalence: every view derived off
// the single fetch must equal what listNotes(folderId) returns today.
describe("note universe — one fetch, per-folder views (perf audit 2026-08)", () => {
  const MEMEX: ReadonlySet<string> = new Set([DEST.vault]);
  const TS = 1_700_000_000_000;

  function universeService(): InMemoryNotesService {
    const svc = new InMemoryNotesService();
    svc.seedReserved(DEST.inbox, DEST.inbox);
    svc.seedReserved(DEST.board, DEST.board);
    svc.seedReserved(DEST.storage, DEST.storage);
    svc.seedReserved(`${DEST.storage}/Work`, "Work", DEST.storage);
    svc.seedReserved(DEST.archive, DEST.archive);
    svc.seedReserved(DEST.trash, DEST.trash);
    svc.seedReserved("vault:wiki", "wiki", null);
    svc.seedReserved("vault:chats", "chats", null);
    svc.seedNote(DEST.inbox, "# inbox note", { createdAt: TS, updatedAt: TS });
    svc.seedNote(`${DEST.storage}/Work`, "# nested work", { createdAt: TS, updatedAt: TS });
    svc.seedNote(DEST.board, "# staged card", { createdAt: TS, updatedAt: TS });
    svc.seedNote(DEST.archive, "# archived", { createdAt: TS, updatedAt: TS, origin: DEST.inbox });
    svc.seedNote(DEST.trash, "# trashed", { createdAt: TS, updatedAt: TS, origin: DEST.inbox });
    svc.seedNote("vault:wiki", "# vault wiki note", { createdAt: TS, updatedAt: TS });
    svc.seedNote("vault:chats", "# a transcript", { createdAt: TS, updatedAt: TS });
    return svc;
  }

  const idset = (ns: { id: string }[]) => ns.map((n) => n.id).sort();

  test("each view off the ONE listAll() equals listNotes(folderId) today", async () => {
    const svc = universeService();
    const raw = await svc.listAll();
    // exactly the folderIds useNoteUniverse covers (undefined = All Notes, the
    // hidden roots, and the vault: root marker)
    const folderIds = [undefined, DEST.board, DEST.storage, DEST.archive, DEST.trash, DEST.vault];
    for (const folderId of folderIds) {
      const viaOneFetch = scopeCorpusNotes(raw, folderId, MEMEX);
      const viaListNotes = await svc.listNotes(folderId);
      expect(idset(viaOneFetch)).toEqual(idset(viaListNotes));
    }
  });

  test("All Notes off the single fetch excludes hidden roots, the Vault, and chats/", async () => {
    const svc = universeService();
    const all = scopeCorpusNotes(await svc.listAll(), undefined, MEMEX);
    const folders = new Set(all.map((n) => n.folderId));
    expect(folders.has(DEST.inbox)).toBe(true);
    expect(folders.has(`${DEST.storage}/Work`)).toBe(true);
    expect([...folders].some((f) => f === DEST.archive || f === DEST.trash || f === DEST.board)).toBe(false);
    expect([...folders].some((f) => f.startsWith("vault:"))).toBe(false);
  });
});
