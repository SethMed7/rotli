import { describe, expect, test } from "bun:test";

import { InMemoryNotesService } from "./inMemoryNotes";
import { createWebAiCorpus } from "./webAiCorpus";

async function corpusWith(bodies: Record<string, string>) {
  const svc = new InMemoryNotesService();
  const ids: Record<string, string> = {};
  for (const [folder, body] of Object.entries(bodies)) {
    const note = await svc.createNote(folder, body);
    ids[folder] = note.id;
  }
  return { corpus: createWebAiCorpus(() => svc), ids, svc };
}

describe("web AI corpus", () => {
  test("a note in a secure folder or with a secret in it is withheld from every model", async () => {
    const { corpus, ids } = await corpusWith({
      Inbox: "# Groceries\n\neggs and milk",
      "Secure notes": "# Bank\n\nplain text but in the secure folder",
      Work: "# Keys\n\nthe stripe key is sk_4eC39HqLyjWDarjtT1zdp7dc do not share",
    });
    const inbox = ids.Inbox!;
    const secureNote = ids["Secure notes"]!;
    const work = ids.Work!;
    const listed = (await corpus.list()).map((n) => n.id);
    expect(listed).toContain(inbox);
    expect(listed).not.toContain(secureNote);
    expect(listed).not.toContain(work);
    expect(await corpus.readableIds([inbox, secureNote, work])).toEqual([inbox]);
    await expect(corpus.read(secureNote)).rejects.toThrow(/secure/);
    expect((await corpus.read(inbox)).body).toContain("eggs");
    expect((await corpus.frontmatter(work))?.secure).toBe(true);
    expect((await corpus.frontmatter(inbox))?.secure).toBe(false);
    expect(await corpus.frontmatter("nope")).toBeNull();
  });

  test("a note flagged secure by hand, in an open folder, is withheld too", async () => {
    const { corpus, svc } = await corpusWith({ Inbox: "# Open\n\nnothing secret" });
    const flagged = await svc.createNote("Inbox", "# Diary\n\nplain words", { secure: true });
    expect((await corpus.list()).map((n) => n.id)).not.toContain(flagged.id);
    await expect(corpus.read(flagged.id)).rejects.toThrow(/secure/);
  });

  // review 2026-11-09 #1, on the web: the list and search rows came from the
  // notes service's summaries, and the verdict from a separate read of the
  // note. A summary still holding a secure version's words rode out on the
  // approval of the public version.
  // Third review: the source-text guard ("no row is spread from a summary or
  // a hit") went when the source-shape ceiling did; this test replaces it.
  // The stale summary and hit carry a private value in EVERY field derived
  // from the note's content, and none may appear anywhere in the answer.
  // scripts/check-web-ai-rows-mutation.mjs applies the reviewer's spread
  // (`{ ...summary, title, snippet }`) to a scratch copy and expects this
  // test to fail there.
  test("rows show only the note read the verdict judged, in every field", async () => {
    const svc = new InMemoryNotesService();
    const note = await svc.createNote("Inbox", "# Harbor plan\n\nharbor opens at nine");
    const canary = "PRIVATE-CANARY-7Q4";
    const stamp = 936835200000; // 1999-09-09, the secure version's dates
    const staleRow = <T extends { id: string }>(row: T): T =>
      row.id === note.id
        ? {
            ...row,
            title: `Harbor ${canary} plan`,
            snippet: `harbor code ${canary} opens at nine`,
            aliases: [`harbor-${canary}`],
            folderId: `Projects/${canary}`,
            diskFolderId: `Projects/${canary}`,
            createdAt: stamp,
            updatedAt: stamp,
            pinned: true,
            bodyEmpty: true,
            matchStart: 9,
            matchLen: canary.length,
            spans: [[9, canary.length]],
          }
        : row;
    const staleList = (await svc.listNotes()).map(staleRow);
    const staleHits = (await svc.searchNotes("harbor", 10)).map(staleRow);
    const stale = Object.assign(Object.create(svc) as InMemoryNotesService, {
      listNotes: async () => staleList,
      searchNotes: async () => staleHits,
    });
    const corpus = createWebAiCorpus(() => stale);
    const nothingPrivate = (answer: unknown) => {
      const json = JSON.stringify(answer);
      expect(json).not.toContain(canary);
      expect(json).not.toContain(String(stamp));
    };
    const listed = await corpus.list();
    expect(listed.map((n) => n.title)).toEqual(["Harbor plan"]);
    nothingPrivate(listed);
    expect(listed[0]?.pinned).toBe(false);
    expect(listed[0]?.bodyEmpty).not.toBe(true);
    const hits = await corpus.search("harbor", 10);
    expect(hits.map((h) => h.title)).toEqual(["Harbor plan"]);
    nothingPrivate(hits);
    // a hit the current note no longer matches is dropped
    expect(await corpus.search(canary, 10)).toEqual([]);
  });

  // third review of pull request 267, #4: a vault that mixes a note, a board
  // and a file. Rotli Web's AI lane leaves boards and files out (as the
  // agent workspace does); none of them comes back as a note.
  test("a mixed vault lists and finds only its notes, as notes", async () => {
    const svc = new InMemoryNotesService();
    const note = await svc.createNote("Inbox", "# Harbor plan\n\nharbor opens at nine");
    Object.assign(svc.seedFile("Inbox/Harbor sketch.excalidraw", "Inbox"), { kind: "board", body: "harbor" });
    Object.assign(svc.seedFile("storage/harbor.csv"), { body: "berth,time\n1,harbor" });
    const corpus = createWebAiCorpus(() => svc);
    const listed = await corpus.list();
    expect(listed.map((n) => [n.id, n.kind ?? "note"])).toEqual([[note.id, "note"]]);
    const hits = await corpus.search("harbor", 10);
    expect(hits.map((h) => [h.id, h.kind])).toEqual([[note.id, "note"]]);
  });

  test("search answers only with readable notes", async () => {
    const { corpus, ids } = await corpusWith({
      Inbox: "# Plan\n\nlaunch checklist",
      "Secure notes": "# Plan two\n\nlaunch secrets",
    });
    const hits = await corpus.search("launch", 10);
    expect(hits.map((h) => h.id)).toEqual([ids.Inbox!]);
  });
});

// the pull-request review (2026-09-29): Rotli Web's update_note had no working write; the seam now
// runs the body-edit policy twin (and the secure/secret rules) itself
describe("the web AI write", () => {
  test("a note the person wrote is refused; a chat-made note is written", async () => {
    const svc = new InMemoryNotesService();
    const mine = await svc.createNote("Inbox", "# Mine\n\nmy words");
    const chat = await svc.createNote("Inbox", "# From chat\n\nchat words", { createdBy: "chat" });
    const corpus = createWebAiCorpus(() => svc);
    await expect(corpus.write(mine.id, "# Mine\n\nrewritten", mine.revision)).rejects.toThrow(
      "the user wrote this note themselves",
    );
    expect((await svc.getNote(mine.id))?.body).toBe("# Mine\n\nmy words");
    const written = await corpus.write(chat.id, "# From chat\n\nrevised", chat.revision);
    expect(written.revision).not.toBe(chat.revision);
    expect((await svc.getNote(chat.id))?.body).toBe("# From chat\n\nrevised");
  });

  test("secret-shaped text never lands in an open note", async () => {
    const svc = new InMemoryNotesService();
    const chat = await svc.createNote("Inbox", "# Keys\n\nnothing yet", { createdBy: "chat" });
    const corpus = createWebAiCorpus(() => svc);
    await expect(
      corpus.write(chat.id, "# Keys\n\nsk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chat.revision),
    ).rejects.toThrow();
  });

  test("a locked note and a note the person switched off are refused", async () => {
    const svc = new InMemoryNotesService();
    const locked = await svc.createNote("Inbox", "# Locked\n\nx", { createdBy: "chat" });
    const off = await svc.createNote("Inbox", "# Off\n\ny", { createdBy: "chat" });
    const lockedNote = await svc.getNote(locked.id);
    const offNote = await svc.getNote(off.id);
    if (!lockedNote || !offNote) throw new Error("notes were not created");
    lockedNote.locked = true;
    offNote.aiBodyEdit = "revoked";
    const corpus = createWebAiCorpus(() => svc);
    await expect(corpus.write(locked.id, "# Locked\n\nchanged", locked.revision)).rejects.toThrow("locked");
    await expect(corpus.write(off.id, "# Off\n\nchanged", off.revision)).rejects.toThrow(
      "turned off AI editing",
    );
    expect((await svc.getNote(off.id))?.body).toBe("# Off\n\ny");
  });
});

// Second review of pull request 267 (#2): Rotli Web's read gave its verdict on one
// getNote answer and returned the body of another. Every web AI entry point
// now decides and answers from one read. This fake answers getNote with the
// public note and its secure version in turn, from either phase.
describe("every web AI entry point decides and answers from one read", () => {
  const CANARY = "PRIVATE-CANARY-7Q4";
  async function alternating(startSecure: boolean) {
    const svc = new InMemoryNotesService();
    const note = await svc.createNote("Inbox", "# Harbor plan\n\nharbor opens at nine", {
      createdBy: "chat",
    });
    const plain = (await svc.getNote(note.id))!;
    const secret = {
      ...plain,
      secure: true,
      title: `Harbor ${CANARY} plan`,
      body: `# Harbor ${CANARY} plan\n\n${CANARY}`,
    };
    let secureNext = startSecure;
    let lastAnswerSecure = false;
    const writes: { body: string; onSecure: boolean }[] = [];
    const fake = Object.assign(Object.create(svc) as InMemoryNotesService, {
      getNote: async (id: string) => {
        if (id !== note.id) return svc.getNote(id);
        lastAnswerSecure = secureNext;
        secureNext = !secureNext;
        return lastAnswerSecure ? secret : plain;
      },
      updateNote: async (id: string, body: string, revision: string) => {
        writes.push({ body, onSecure: lastAnswerSecure });
        return svc.updateNote(id, body, revision);
      },
    });
    return { corpus: createWebAiCorpus(() => fake), id: note.id, revision: plain.revision, writes };
  }

  test("the corpus has exactly the entry points this test covers", async () => {
    const { corpus } = await alternating(false);
    expect(Object.keys(corpus).sort()).toEqual([
      "frontmatter",
      "list",
      "read",
      "readableIds",
      "search",
      "write",
    ]);
  });

  for (const startSecure of [false, true]) {
    test(`no answer carries the secure version (first answer ${startSecure ? "secure" : "public"})`, async () => {
      const calls: ((c: Awaited<ReturnType<typeof alternating>>) => Promise<unknown>)[] = [
        ({ corpus, id }) => corpus.read(id),
        ({ corpus }) => corpus.list(),
        ({ corpus }) => corpus.search("harbor", 10),
        ({ corpus, id }) => corpus.readableIds([id]),
        ({ corpus, id }) => corpus.frontmatter(id),
      ];
      for (const call of calls) {
        // a fresh fake per entry point, so each starts in the phase under test
        const answer = await call(await alternating(startSecure)).catch(() => null);
        expect(JSON.stringify(answer) ?? "").not.toContain(CANARY);
      }
    });

    test(`a write never lands on the version it judged secure (first answer ${startSecure ? "secure" : "public"})`, async () => {
      const { corpus, id, revision, writes } = await alternating(startSecure);
      await corpus.write(id, "# Harbor plan\n\nharbor opens at ten", revision).catch(() => undefined);
      // the one read that decided is the answer the write rode on; a write
      // decided on a public read but landing after a secure answer is the bug
      expect(writes.filter((w) => w.onSecure)).toEqual([]);
    });
  }
});
