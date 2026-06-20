// The in-memory NotesService is the browser/dev mirror of the Rust corpus.
// These lock the invariants both implementations share: ulid time-ordering,
// the three-case descendant scoping, the pinned→updatedAt→id sort (the
// SP-2/TSP-4 id tiebreak), and the origin breadcrumb rule across the
// archive/trash/restore lifecycle.

import { describe, expect, it } from "bun:test";
import { DEST } from "./destinations";
import { InMemoryNotesService, ulid } from "./notes";

// A fresh service seeded with the five reserved roots + two nested Brain
// folders, mirroring how the browser surface is built (ids ARE paths).
function freshService(): InMemoryNotesService {
  const svc = new InMemoryNotesService();
  svc.seedReserved(DEST.inbox, DEST.inbox);
  svc.seedReserved(DEST.brain, DEST.brain);
  svc.seedReserved(DEST.storage, DEST.storage);
  svc.seedReserved(DEST.archive, DEST.archive);
  svc.seedReserved(DEST.trash, DEST.trash);
  svc.seedReserved(`${DEST.brain}/Work`, "Work", DEST.brain);
  svc.seedReserved(`${DEST.brain}/Myela`, "Myela", DEST.brain);
  return svc;
}

describe("ulid", () => {
  it("is 26 chars of Crockford base32", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("sorts lexicographically by the time prefix (later time → larger id)", () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(2_000_000_000_000);
    expect(early < late).toBe(true);
  });

  it("differs in the random tail for the same timestamp", () => {
    const t = 1_700_000_000_000;
    // sharing a prefix, the 16-char random tail makes collisions effectively nil
    expect(ulid(t)).not.toBe(ulid(t));
  });
});

describe("createNote / getNote / updateNote", () => {
  it("derives title + snippet, stamps created==updated, defaults unpinned", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# Hello\n\nFirst body line.");
    expect(note.title).toBe("Hello");
    expect(note.snippet).toBe("First body line.");
    expect(note.folderId).toBe(DEST.inbox);
    expect(note.pinned).toBe(false);
    expect(note.createdAt).toBe(note.updatedAt);
    expect(note.body).toBe("# Hello\n\nFirst body line.");
  });

  it("round-trips through getNote, returns null for a miss", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# Hi");
    expect(await svc.getNote(note.id)).toEqual(note);
    expect(await svc.getNote("nope")).toBeNull();
  });

  it("re-derives title/snippet and bumps updatedAt on update", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# Before");
    const updated = await svc.updateNote(note.id, "# After\n\nnew body");
    expect(updated.title).toBe("After");
    expect(updated.snippet).toBe("new body");
    expect(updated.createdAt).toBe(note.createdAt); // created never moves
    expect(updated.updatedAt).toBeGreaterThanOrEqual(note.updatedAt);
    expect(updated.id).toBe(note.id); // id is the through-line
  });

  it("throws a recognizable 'unknown note' error on a missing update", async () => {
    const svc = freshService();
    expect(svc.updateNote("ghost", "x")).rejects.toThrow("unknown note: ghost");
  });
});

describe("listNotes — three-case descendant scoping", () => {
  it("All Notes (no folderId) excludes the hidden roots", async () => {
    const svc = freshService();
    await svc.createNote(DEST.inbox, "# visible inbox");
    await svc.createNote(`${DEST.brain}/Work`, "# visible nested");
    await svc.createNote(DEST.archive, "# archived");
    await svc.createNote(DEST.trash, "# trashed");

    const all = await svc.listNotes();
    const titles = all.map((n) => n.title).sort();
    expect(titles).toEqual(["visible inbox", "visible nested"]);
  });

  it("a normal folder includes its descendants (a folder holds everything under it)", async () => {
    const svc = freshService();
    await svc.createNote(DEST.brain, "# top brain");
    await svc.createNote(`${DEST.brain}/Work`, "# under work");
    await svc.createNote(`${DEST.brain}/Myela`, "# under myela");
    await svc.createNote(DEST.inbox, "# elsewhere");

    const inBrain = await svc.listNotes(DEST.brain);
    const titles = inBrain.map((n) => n.title).sort();
    expect(titles).toEqual(["top brain", "under myela", "under work"]);
  });

  it("a hidden root shows ONLY its own subtree (and is allowed to)", async () => {
    const svc = freshService();
    await svc.createNote(DEST.archive, "# archived note");
    await svc.createNote(DEST.inbox, "# normal note");

    const archived = await svc.listNotes(DEST.archive);
    expect(archived.map((n) => n.title)).toEqual(["archived note"]);
  });

  it("scopes by the folder TREE (a note's folder must be a real descendant)", async () => {
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
  it("pins float to the top, then newest, then id ascending on a tie", async () => {
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

  it("summaries carry no body field", async () => {
    const svc = freshService();
    await svc.createNote(DEST.inbox, "# has body\n\nsecret");
    const [row] = await svc.listNotes(DEST.inbox);
    expect(row).toBeDefined();
    expect("body" in (row as object)).toBe(false);
  });
});

describe("moveNote + the origin breadcrumb rule", () => {
  it("entering a hidden root from a normal folder records the origin", async () => {
    const svc = freshService();
    const note = await svc.createNote(`${DEST.brain}/Work`, "# a thought");
    expect(svc.origins.has(note.id)).toBe(false);

    const archived = await svc.archiveNote(note.id);
    expect(archived.folderId).toBe(DEST.archive);
    expect(archived.id).toBe(note.id); // id preserved through the move
    expect(svc.origins.get(note.id)).toBe(`${DEST.brain}/Work`);
  });

  it("restore reads the breadcrumb, lands the note home, and CLEARS the origin", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.brain, "# keep this");
    await svc.archiveNote(note.id);
    expect(svc.origins.get(note.id)).toBe(DEST.brain);

    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(DEST.brain);
    expect(svc.origins.has(note.id)).toBe(false); // breadcrumb dropped — it's home now
  });

  it("restore falls back to Inbox when the origin folder is gone", async () => {
    const svc = freshService();
    const note = await svc.createNote(`${DEST.brain}/Work`, "# orphan");
    await svc.trashNote(note.id);
    await svc.deleteFolder(`${DEST.brain}/Work`); // its home disappears
    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(DEST.inbox);
  });

  it("restore falls back to Inbox when there is no breadcrumb at all", async () => {
    const svc = freshService();
    // a note that lives directly in Trash with no recorded origin
    const note = svc.seedNote(DEST.trash, "# no origin", { createdAt: 1, updatedAt: 1 });
    expect(svc.origins.has(note.id)).toBe(false);
    const restored = await svc.restoreNote(note.id);
    expect(restored.folderId).toBe(DEST.inbox);
  });

  it("restore of a root-origin note returns it to the corpus root, not Inbox (TSP-3)", async () => {
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

  it("an archived note still EXISTS via getNote (the pruneQuick premise — SP-1)", async () => {
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

  it("a plain visible→visible move never stamps an origin", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.inbox, "# moving around");
    await svc.moveNote(note.id, DEST.brain);
    expect(svc.origins.has(note.id)).toBe(false);
    expect((await svc.getNote(note.id))?.folderId).toBe(DEST.brain);
  });

  it("hidden→hidden keeps the existing breadcrumb untouched", async () => {
    const svc = freshService();
    const note = await svc.createNote(DEST.brain, "# from brain");
    await svc.trashNote(note.id); // origin = Brain
    expect(svc.origins.get(note.id)).toBe(DEST.brain);
    await svc.moveNote(note.id, DEST.archive); // hidden → hidden
    expect(svc.origins.get(note.id)).toBe(DEST.brain); // unchanged
  });

  it("archiveNote/trashNote land in their reserved roots", async () => {
    const svc = freshService();
    const a = await svc.createNote(DEST.inbox, "# one");
    const b = await svc.createNote(DEST.inbox, "# two");
    expect((await svc.archiveNote(a.id)).folderId).toBe(DEST.archive);
    expect((await svc.trashNote(b.id)).folderId).toBe(DEST.trash);
  });

  it("throws on moving an unknown note", async () => {
    const svc = freshService();
    expect(svc.moveNote("ghost", DEST.brain)).rejects.toThrow("unknown note: ghost");
  });
});
