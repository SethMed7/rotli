import { describe, expect, test } from "bun:test";

import type { VaultAction } from "../lib/librarianPeople";
import { DEFAULT_LIBRARIAN_RULES, type LibrarianRules } from "../lib/librarianRules";
import { answerUpdate, type KeepDeps, keepVault, PROTECTED_PERSON } from "./librarianPeople";

function fakeKeep(over: Partial<KeepDeps> = {}) {
  const steps: string[] = [];
  let rules: LibrarianRules = structuredClone(DEFAULT_LIBRARIAN_RULES);
  let made = 0;
  const deps: KeepDeps = {
    rules: () => rules,
    setRules: (next) => {
      rules = next;
      steps.push("rules");
    },
    saveRules: async () => {
      steps.push("save");
    },
    createNote: async (body) => {
      steps.push(`create ${body.split("\n")[0]}`);
      return `01NEW${++made}`;
    },
    notePath: async (id) => `wiki/_inbox/${id}.md`,
    log: async (row) => {
      steps.push(`log ${row.action} ${row.noteTitle} ${row.after}`);
    },
    apply: async (actions, note) => {
      steps.push(`apply ${note.id} ${JSON.stringify(actions)}`);
      return actions.length;
    },
    refresh: async () => {
      steps.push("refresh");
    },
    existingPerson: async () => null,
    ...over,
  };
  return { deps, steps, rules: () => rules };
}

describe("keeping what the person said", () => {
  const vault: VaultAction[] = [
    { type: "group", name: "Neighbors" },
    { type: "rule", text: "Notes about Ana go to People/Work" },
    { type: "person", name: "Ana", area: "People/Work", about: "Works at Northwind.", tags: ["northwind"] },
    { type: "update", noteId: "01SAM", name: "Sam", from: "people/friends", area: "People/Work", tags: [] },
  ];

  test("rules are saved before any note is filed; each new person is created, journaled, tagged and filed", async () => {
    const keep = fakeKeep();
    const lines = await keepVault(vault, "claude-opus", keep.deps);
    expect(keep.steps).toEqual([
      "rules",
      "save",
      "create # Ana",
      "log create Ana wiki/_inbox/01NEW1.md",
      'apply 01NEW1 [{"type":"tag","tags":["northwind"]},{"type":"file","area":"People/Work","create":true}]',
      "refresh",
    ]);
    expect(keep.rules().people.groups.at(-1)).toBe("Neighbors");
    expect(keep.rules().filing).toEqual(["Notes about Ana go to People/Work"]);
    expect(lines).toEqual([
      { text: "Added the People group Neighbors" },
      { text: "Added the rule “Notes about Ana go to People/Work”" },
      { text: "Added Ana to People/Work", noteId: "01NEW1" },
    ]);
  });

  test("one person failing doesn't stop the others", async () => {
    const keep = fakeKeep({
      createNote: async (body) => {
        if (body.startsWith("# Bank")) throw new Error("the note is protected");
        return "01OK";
      },
    });
    const lines = await keepVault(
      [
        { type: "person", name: "Bank person", area: null, about: "", tags: [] },
        { type: "person", name: "Leo", area: null, about: "", tags: [] },
      ],
      "m",
      keep.deps,
    );
    expect(lines).toEqual([
      { text: "Couldn’t add Bank person: the note is protected", failed: true },
      { text: "Added a note for Leo", noteId: "01OK" },
    ]);
    expect(keep.steps).not.toContain("save");
  });

  test("a yes to a question changes only that note's tags and group", async () => {
    const keep = fakeKeep();
    const update = vault[3] as Extract<VaultAction, { type: "update" }>;
    expect(await answerUpdate(update, "m", keep.deps)).toBe(1);
    expect(keep.steps).toEqual(['apply 01SAM [{"type":"file","area":"People/Work","create":true}]']);
  });
});

// Seventh review of pull request 267 (finding 6): secure People are left out
// of the Librarian's listing, so a reply asking to tag or file one comes back
// as someone new. Rotli looks the name up locally before making a note.
describe("a reply that names someone who already has a note", () => {
  const ana: VaultAction[] = [
    { type: "person", name: "Ana", area: "People/Work", about: "Works at Northwind.", tags: ["northwind"] },
  ];

  test("a protected person: nothing is made or changed, and the person is told why", async () => {
    const keep = fakeKeep({ existingPerson: async (name) => (name === "Ana" ? "protected" : null) });
    const lines = await keepVault(ana, "claude-opus", keep.deps);
    expect(lines.map((line) => line.text)).toEqual([PROTECTED_PERSON]);
    expect(keep.steps.filter((step) => step.startsWith("create") || step.startsWith("apply"))).toEqual([]);
  });

  test("a look-up that fails counts as protected: nothing is made", async () => {
    const keep = fakeKeep({
      existingPerson: async () => {
        throw new Error("the vault couldn't be listed");
      },
    });
    const lines = await keepVault(ana, "claude-opus", keep.deps);
    expect(lines.map((line) => line.text)).toEqual([PROTECTED_PERSON]);
    expect(keep.steps.some((step) => step.startsWith("create"))).toBe(false);
  });

  test("an unprotected person who already has a note isn't made twice", async () => {
    const keep = fakeKeep({ existingPerson: async () => "plain" });
    const lines = await keepVault(ana, "claude-opus", keep.deps);
    expect(lines.map((line) => line.text)).toEqual(["Ana already has a note, so no new one was made"]);
    expect(keep.steps.some((step) => step.startsWith("create"))).toBe(false);
  });
});
