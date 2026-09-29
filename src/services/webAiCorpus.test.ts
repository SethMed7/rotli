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
});
