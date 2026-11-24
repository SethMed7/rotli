// What the chat composer's commands may write. `mock.module` is process-wide
// and outlives this file, so each mock spreads the REAL module and afterAll
// puts it back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as liveBoards from "../../boards/composition";
import * as liveRegistry from "../../keys/registry";
import type { MemexInstance } from "../../memex/config";
import * as liveNoteChat from "../../noteChat/composition";
import * as liveCreateNote from "../../services/createNote";
import * as liveHooks from "../../services/hooks";
import type { NoteSummary } from "../../types";

const realBoards = { ...liveBoards };
const realRegistry = { ...liveRegistry };
const realNoteChat = { ...liveNoteChat };
const realCreateNote = { ...liveCreateNote };
const realHooks = { ...liveHooks };

let boards: string[] = [];
let dispatched: string[] = [];
let created: { body: string; secure: boolean }[] = [];
let attachmentVault = "default";

void mock.module("../../boards/composition", () => ({
  ...realBoards,
  boardsAvailable: () => true,
  createEditableBoardFromMermaid: async (definition: string) => {
    boards.push(definition);
    return "board-1";
  },
}));
void mock.module("../../keys/registry", () => ({
  ...realRegistry,
  dispatch: (id: string) => void dispatched.push(id),
}));
void mock.module("../../services/createNote", () => ({
  ...realCreateNote,
  createChatNote: async (_instance: unknown, body: string, _by: unknown, policy?: { secure?: boolean }) => {
    created.push({ body, secure: policy?.secure === true });
    return { id: "note-1", stem: "saved-reply" };
  },
}));
void mock.module("../../services/hooks", () => ({ ...realHooks, invalidateNotes: async () => {} }));
void mock.module("../../noteChat/composition", () => ({
  ...realNoteChat,
  noteAttachment: async () => ({ instance: { id: attachmentVault }, stem: "fixture-plan", secure: false }),
}));
afterAll(() => {
  void mock.module("../../boards/composition", () => realBoards);
  void mock.module("../../keys/registry", () => realRegistry);
  void mock.module("../../services/createNote", () => realCreateNote);
  void mock.module("../../services/hooks", () => realHooks);
  void mock.module("../../noteChat/composition", () => realNoteChat);
});

const { availableChatCommands, pendingNoteFor, runChatCommand } = await import("./chatComposerCommands");

const instance = { id: "default", perms: "chats+inbox" } as MemexInstance;
const withDiagram = [
  { speaker: "you", text: "sketch the flow" },
  { speaker: "rotli", text: "```mermaid\ngraph TD\nIntake-->Review\n```" },
];
let notes: string[] = [];
let opened: string[] = [];
const context = (overrides: Partial<Parameters<typeof runChatCommand>[1]> = {}) => ({
  instance,
  writable: true,
  chatTitle: "Flow chat",
  messages: withDiagram,
  secure: false,
  hasNote: false,
  canPickModel: true,
  rootId: "default",
  openModelPicker: () => {},
  openNote: (id: string) => void opened.push(id),
  notify: (text: string) => void notes.push(text),
  ...overrides,
});

beforeEach(() => {
  boards = [];
  dispatched = [];
  created = [];
  notes = [];
  opened = [];
  attachmentVault = "default";
});

describe("/board", () => {
  test("turns the latest diagram into a board", async () => {
    await runChatCommand("board", context());
    expect(boards).toEqual(["graph TD\nIntake-->Review"]);
  });

  test("a chat carrying secure-note content never launders its diagram into a board", async () => {
    await runChatCommand("board", context({ secure: true }));
    expect(boards).toEqual([]);
    expect(notes[0]).toContain("secure-note content");
  });

  test("with no diagram it opens the new-board flow", async () => {
    await runChatCommand("board", context({ messages: [{ speaker: "rotli", text: "Plain words." }] }));
    expect(dispatched).toEqual(["boards.new"]);
  });
});

describe("/note", () => {
  test("saves the latest reply and opens it", async () => {
    await runChatCommand("note", context({ messages: [{ speaker: "rotli", text: "Review weekly." }] }));
    expect(created).toEqual([{ body: "# Flow chat\n\nReview weekly.\n", secure: false }]);
    expect(opened).toEqual(["note-1"]);
  });

  test("a secure chat's reply is saved as a secure note", async () => {
    await runChatCommand("note", context({ secure: true }));
    expect(created[0]?.secure).toBe(true);
  });
});

describe("what the menu offers", () => {
  test("note needs a reply and a writable vault; attach needs a chat without a note", () => {
    const none = availableChatCommands({ ...context(), messages: [], writable: false, hasNote: true });
    expect([...none].sort()).toEqual(["board", "model", "new"]);
    expect([...availableChatCommands(context())].sort()).toEqual(["attach", "board", "model", "new", "note"]);
  });

  test("tag stays hidden until the tag API exists", () => {
    expect(availableChatCommands(context()).has("tag")).toBe(false);
  });
});

describe("@ picks", () => {
  const plan: NoteSummary = {
    id: "n-plan",
    title: "Fixture plan",
    snippet: "",
    folderId: "Notes",
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
  };

  test("a note from the chat's own vault becomes the pending attachment", async () => {
    expect(await pendingNoteFor(plan, "default", (text) => void notes.push(text))).toEqual({
      noteId: "n-plan",
      title: "Fixture plan",
      stem: "fixture-plan",
      secure: false,
    });
  });

  test("a chat pinned to another vault refuses the note", async () => {
    attachmentVault = "work";
    expect(await pendingNoteFor(plan, "default", (text) => void notes.push(text))).toBeNull();
    expect(notes[0]).toContain("another vault");
  });
});
