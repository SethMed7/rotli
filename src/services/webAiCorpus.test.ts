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
  return { corpus: createWebAiCorpus(() => svc), ids };
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

  test("search answers only with readable notes", async () => {
    const { corpus, ids } = await corpusWith({
      Inbox: "# Plan\n\nlaunch checklist",
      "Secure notes": "# Plan two\n\nlaunch secrets",
    });
    const hits = await corpus.search("launch", 10);
    expect(hits.map((h) => h.id)).toEqual([ids.Inbox!]);
  });
});
