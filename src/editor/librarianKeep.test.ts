import { beforeEach, describe, expect, test } from "bun:test";

import type { VaultAction } from "../lib/librarianPeople";
import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import type { KeepDeps } from "../services/librarianPeople";
import { closeLibrarianChat, startLibrarianChat, useLibrarianBar } from "../state/librarianBar";
import { answerAsk, settleVault } from "./librarianKeep";

const VAULT: VaultAction[] = [
  { type: "person", name: "Ana", area: "People/Work", about: "Works at Northwind.", tags: [] },
  { type: "update", noteId: "01SAM", name: "Sam", from: "people/friends", area: "People/Work", tags: [] },
];

const applied: string[] = [];
const deps: KeepDeps = {
  rules: () => structuredClone(DEFAULT_LIBRARIAN_RULES),
  setRules: () => {},
  saveRules: async () => {},
  createNote: async () => "01ANA",
  notePath: async (id) => `wiki/_inbox/${id}.md`,
  log: async () => {},
  apply: async (actions, note) => {
    applied.push(note.id);
    return actions.length;
  },
  refresh: async () => {},
};

const turn = () => useLibrarianBar.getState().chat!.turns[0]!;

beforeEach(() => {
  applied.length = 0;
  closeLibrarianChat();
  startLibrarianChat({
    id: "c1",
    paneId: "p1",
    noteId: "n1",
    modelId: "m",
    turns: [
      {
        id: "t1",
        role: "librarian",
        text: "Adding Ana; Sam has a note.",
        raw: "",
        actions: [],
        vault: VAULT,
      },
    ],
    status: "idle",
    error: null,
    minimized: false,
  });
});

describe("a statement's vault actions in the conversation", () => {
  test("new people are added at once; someone known becomes an open question", async () => {
    await settleVault("c1", "t1", VAULT, "m", deps);
    expect(turn()).toMatchObject({
      kept: { kind: "kept", lines: [{ text: "Added Ana to People/Work", noteId: "01ANA" }] },
      asks: [{ kind: "open" }],
    });
    expect(applied).toEqual(["01ANA"]);
  });

  test("yes changes the known person's note; no leaves it; either answers the question once", async () => {
    await settleVault("c1", "t1", VAULT, "m", deps);
    await answerAsk("c1", "t1", 0, false, deps);
    expect(turn().asks).toEqual([{ kind: "answered", yes: false, message: "Left Sam as they are." }]);
    await answerAsk("c1", "t1", 0, true, deps); // already answered: nothing happens
    expect(applied).toEqual(["01ANA"]);
  });

  test("yes applies, and a failure puts the question back with the reason", async () => {
    await settleVault("c1", "t1", VAULT, "m", deps);
    await answerAsk("c1", "t1", 0, true, deps);
    expect(turn().asks).toEqual([{ kind: "answered", yes: true, message: "Updated Sam." }]);
    expect(applied).toEqual(["01ANA", "01SAM"]);

    startLibrarianChat({
      ...useLibrarianBar.getState().chat!,
      turns: [{ ...turn(), asks: [{ kind: "open" }] }],
    });
    await answerAsk("c1", "t1", 0, true, {
      apply: async () => {
        throw new Error("This note is locked");
      },
    });
    expect(turn().asks).toEqual([{ kind: "open" }]);
    expect(useLibrarianBar.getState().chat?.error).toBe("This note is locked");
  });
});
