import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { describeUpdate, parseVaultActions, peopleNotes, personBody } from "./librarianPeople";
import { DEFAULT_LIBRARIAN_RULES, type LibrarianRules } from "./librarianRules";

const note = (id: string, title: string, folder: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: folder,
  diskFolderId: folder,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  ...extra,
});

const rules = (change: Partial<LibrarianRules> = {}): LibrarianRules => ({
  ...structuredClone(DEFAULT_LIBRARIAN_RULES),
  ...change,
});

describe("the People notes the vault already has", () => {
  test("notes under wiki/People in any case, newest first, never secure ones or files", () => {
    const found = peopleNotes([
      note("a", "Ana Ruiz", "wiki/people/friends", { updatedAt: 5 }),
      note("b", "Leo Park", "wiki/People/Work", { updatedAt: 9 }),
      note("c", "Bank login", "wiki/people", { secure: true }),
      note("d", "photo.png", "wiki/people/family", { kind: "file" }),
      note("e", "Q3 plan", "wiki/projects"),
      note("f", "Peoplesoft notes", "wiki/peoplesoft"),
    ]);
    expect(found).toEqual([
      { id: "b", title: "Leo Park", area: "People/Work" },
      { id: "a", title: "Ana Ruiz", area: "people/friends" },
    ]);
  });
});

describe("a statement's vault actions", () => {
  // "Ana and Leo are work people, they work at Northwind; so did Sam and Ivy,
  // but they no longer work with us" — Sam already has a note, in Friends
  const known = [{ id: "01SAM", title: "Sam", area: "people/friends" }];
  const reply = [
    { type: "rule", text: "Notes about Ana or Leo go to People/Work" },
    { type: "person", name: "Ana", group: "work", about: "Works at Northwind.", tags: ["northwind"] },
    { type: "person", name: "Leo", group: "Work", about: "Works at Northwind." },
    {
      type: "person",
      name: "sam",
      group: "Work",
      about: "Worked at Northwind; no longer does.",
      tags: ["former"],
    },
    { type: "person", name: "Ivy", group: "Work", about: "Worked at Northwind; no longer does." },
  ];

  test("new people become notes, someone known becomes a question, and the rule is added", () => {
    expect(parseVaultActions(reply, { rules: rules(), known })).toEqual([
      { type: "rule", text: "Notes about Ana or Leo go to People/Work" },
      { type: "person", name: "Ana", area: "People/Work", about: "Works at Northwind.", tags: ["northwind"] },
      { type: "person", name: "Leo", area: "People/Work", about: "Works at Northwind.", tags: [] },
      {
        type: "update",
        noteId: "01SAM",
        name: "Sam",
        from: "people/friends",
        area: "People/Work",
        tags: ["former"],
      },
      {
        type: "person",
        name: "Ivy",
        area: "People/Work",
        about: "Worked at Northwind; no longer does.",
        tags: [],
      },
    ]);
  });

  test("a new group can take people in the same reply; unknown groups file nowhere", () => {
    const actions = parseVaultActions(
      [
        { type: "person", name: "Mo", group: "Neighbors" },
        { type: "group", name: "Neighbors" },
        { type: "person", name: "Jo", group: "Strangers" },
      ],
      { rules: rules(), known: [] },
    );
    expect(actions).toEqual([
      { type: "group", name: "Neighbors" },
      { type: "person", name: "Mo", area: "People/Neighbors", about: "", tags: [] },
      { type: "person", name: "Jo", area: null, about: "", tags: [] },
    ]);
  });

  test("anything outside the grammar or the limits is dropped, never guessed at", () => {
    const actions = parseVaultActions(
      [
        { type: "group", name: "_hidden" },
        { type: "group", name: "work" }, // already there
        { type: "rule", text: "x".repeat(201) },
        { type: "rule", text: "Recipes go to Cooking" }, // already there
        { type: "person", name: "../etc" },
        { type: "person", name: "" },
        { type: "person", name: "Ana" },
        { type: "person", name: "ANA" }, // the same person twice
        { type: "rewrite", text: "x" },
        "not an object",
      ],
      { rules: rules({ filing: ["Recipes go to Cooking"] }), known: [] },
    );
    expect(actions).toEqual([{ type: "person", name: "Ana", area: null, about: "", tags: [] }]);
  });

  test("with one People list, everyone goes to People and no group is added", () => {
    const simple = rules({ people: { mode: "simple", groups: ["Family"] } });
    expect(
      parseVaultActions(
        [
          { type: "group", name: "Neighbors" },
          { type: "person", name: "Ana", group: "Family" },
        ],
        { rules: simple, known: [] },
      ),
    ).toEqual([{ type: "person", name: "Ana", area: "People", about: "", tags: [] }]);
  });

  test("someone known who needs no change asks nothing", () => {
    const here = [{ id: "01ANA", title: "Ana", area: "people/work" }];
    expect(
      parseVaultActions([{ type: "person", name: "Ana", group: "Work" }], { rules: rules(), known: here }),
    ).toEqual([]);
  });

  test("a new person's note, and the question for someone known, in words", () => {
    expect(
      personBody({ type: "person", name: "Ana", area: null, about: "Works at Northwind.", tags: [] }),
    ).toBe("# Ana\n\nWorks at Northwind.\n");
    expect(personBody({ type: "person", name: "Leo", area: null, about: "", tags: [] })).toBe("# Leo\n");
    expect(
      describeUpdate({
        type: "update",
        noteId: "01SAM",
        name: "Sam",
        from: "people/friends",
        area: "People/Work",
        tags: ["former"],
      }),
    ).toBe(
      "Sam already has a note in people/friends. Move it from people/friends to People/Work and tag it former?",
    );
  });
});
