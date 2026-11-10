import { beforeEach, describe, expect, test } from "bun:test";

import type { ApprovedNote } from "../ai/approvedRead";
import type { CompleteReq } from "../ai/types";
import type { LibrarianContext } from "../lib/librarianChat";
import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import { approved, approvedRows, person } from "../lib/promptText.fixtures";
import type { ChatModelInfo, CorpusNoteMeta } from "../lib/tauri";
import { IMPORTED_FOLDER_ROLES } from "../services/destinations";
import { LIBRARIAN_REFUSALS } from "../services/librarianBar";
import { useChatDrafts } from "../state/chatDrafts";
import { closeLibrarianChat, startLibrarianChat, useLibrarianBar } from "../state/librarianBar";
import { usePanesStore } from "../state/panes";
import { findLeaf } from "../state/paneTree";
import {
  applyProposal,
  chatDraft,
  librarianContext,
  type LibrarianReads,
  libraryAreas,
  sendToLibrarian,
  takeToChat,
} from "./librarianSession";

const MODEL: ChatModelInfo = {
  id: "claude-opus",
  label: "Claude Opus",
  provider: "claude",
  endpoint: "",
  api: "cli",
  vision: false,
  isDefault: false,
};
const NOTE = "# Maya Chen\n\nMet Maya at the design meetup.";
const context = async (): Promise<LibrarianContext> => ({
  title: approved("Maya Chen"),
  doc: approved(NOTE),
  areas: [approved("people")],
  tags: [],
  people: [person("People")],
  filing: [],
  rules: structuredClone(DEFAULT_LIBRARIAN_RULES),
  known: [],
});
const HIGHLIGHT = { exact: "design meetup", prefix: "Met Maya at the ", suffix: "." };

function start(id = "chat-1") {
  startLibrarianChat({
    id,
    paneId: "p1",
    noteId: "n1",
    modelId: MODEL.id,
    turns: [],
    status: "idle",
    error: null,
    minimized: false,
  });
}

/** A model that answers with `reply` and remembers what it was sent. */
function fakeModel(reply: string | (() => Promise<string>)) {
  const sent: CompleteReq["messages"][] = [];
  return {
    sent,
    hostFor: () => ({
      complete: async ({ messages }: CompleteReq) => {
        sent.push(messages);
        return typeof reply === "string" ? reply : reply();
      },
    }),
  };
}

const chat = () => useLibrarianBar.getState().chat!;
const allow = async () => null;

beforeEach(() => closeLibrarianChat());

// Second review of pull request 267 (#4): the People context came from the
// UI's note index, which carries no secure flag in the Mac app and can be
// stale, so a secure People note's title reached the prompt. It now comes
// from the gated AI listing for the model in use, asked on every send.
describe("the People the Librarian is told about", () => {
  // what the read gate answers for this model: Wilhelmina's People note is
  // secure, so the gated listing leaves her out, whatever any UI summary says
  const row = (id: string, title: string, folder: string, updatedAt: number): CorpusNoteMeta => ({
    id,
    title,
    snippet: "",
    folderId: folder,
    diskFolderId: folder,
    createdAt: 0,
    updatedAt,
    pinned: false,
    kind: "note",
  });
  /** The gated reads for the Librarian's model; `asked` records each call. */
  const reads = (asked: string[] = []): LibrarianReads => ({
    flush: async (id) => void asked.push(`flush ${id}`),
    note: async (id, model): Promise<ApprovedNote> => {
      asked.push(`note ${id} ${model.id}`);
      return { id, revision: "r1", text: approved(NOTE), body: approved(NOTE), title: approved("Maya Chen") };
    },
    listing: async (model) => {
      asked.push(`listing ${model.id}`);
      return {
        folderIds: [approved("wiki/People"), approved("wiki/Projects")],
        people: approvedRows([row("leo", "Leo", "wiki/People", 2), row("plan", "Plan", "wiki/Projects", 1)]),
      };
    },
  });

  test("come from the gated listing for the model in use", async () => {
    const asked: string[] = [];
    const ctx = await librarianContext("n1", MODEL, reads(asked));
    expect<string[]>(ctx.known.map((person) => person.title)).toEqual(["Leo"]);
    // saved first, then the note and the listing through the gate for this model
    expect(asked[0]).toBe("flush n1");
    expect(asked.slice(1).sort()).toEqual([`listing ${MODEL.id}`, `note n1 ${MODEL.id}`]);
    // the words and the areas come from those same gated reads
    expect<string>(ctx.doc).toBe(NOTE);
    expect<string[]>([...ctx.areas]).toEqual(["People", "Projects"]);
  });

  test("a secure People note's title never reaches the prompt", async () => {
    start();
    const model = fakeModel('{"actions":[]}');
    await sendToLibrarian(
      "chat-1",
      { text: person("Who do I know?"), highlight: null },
      MODEL,
      (sending) => librarianContext("n1", sending, reads()),
      allow,
      model.hostFor,
    );
    const prompt = JSON.stringify(model.sent);
    expect(prompt).toContain("Leo (People)");
    expect(prompt).not.toContain("Wilhelmina");
  });
});

describe("a conversation with the Librarian", () => {
  test("a message joins the chat, and the reply comes back with its proposals ready to apply", async () => {
    start();
    const model = fakeModel('She is someone you met.\n{"actions":[{"type":"file","area":"people"}]}');
    await sendToLibrarian(
      "chat-1",
      { text: person("Who is this?"), highlight: HIGHLIGHT },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    expect(chat().status).toBe("idle");
    expect(chat().turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "Who is this?"],
      ["librarian", "She is someone you met."],
    ]);
    expect(chat().turns[0]).toMatchObject({ highlight: HIGHLIGHT });
    expect(chat().turns[1]).toMatchObject({
      actions: [{ type: "file", area: "people", create: false }],
      proposal: { kind: "open", picked: [true] },
    });
    expect(model.sent[0]?.map((message) => message.role)).toEqual(["system", "user"]);
  });

  test("every turn sends the conversation so far", async () => {
    start();
    const model = fakeModel("Noted.");
    await sendToLibrarian(
      "chat-1",
      { text: person("First"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    await sendToLibrarian(
      "chat-1",
      { text: person("Second"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    expect(model.sent[1]?.map((message) => [message.role, message.content])).toEqual([
      ["system", expect.stringContaining("Met Maya at the design meetup.")],
      ["user", "First"],
      ["assistant", "Noted."],
      ["user", "Second"],
    ]);
    // a reply with nothing to organize has nothing to apply
    expect(chat().turns[1]?.proposal).toBeUndefined();
  });

  test("every send asks again: a note made secure mid-conversation is never sent", async () => {
    start();
    const model = fakeModel("never");
    await sendToLibrarian(
      "chat-1",
      { text: person("Tag it"), highlight: null },
      MODEL,
      context,
      async () => "The Librarian doesn’t read secure notes.",
      model.hostFor,
    );
    expect(model.sent).toHaveLength(0);
    expect(chat().status).toBe("idle");
    expect(chat().error).toBe("The Librarian doesn’t read secure notes.");
  });

  test("a refusal check that fails counts as a refusal", async () => {
    start();
    const model = fakeModel("never");
    await sendToLibrarian(
      "chat-1",
      { text: person("Tag it"), highlight: null },
      MODEL,
      context,
      async () => {
        throw new Error("frontmatter unreadable");
      },
      model.hostFor,
    );
    expect(model.sent).toHaveLength(0);
    expect(chat().error).not.toBeNull();
  });

  test("a secret in the conversation is refused before anything is sent", async () => {
    start();
    const model = fakeModel("never");
    await sendToLibrarian(
      "chat-1",
      { text: person("my key is sk-ant-abcdefghijklmnopqrstuvwx"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    expect(model.sent).toHaveLength(0);
    expect(chat().error).toBe(LIBRARIAN_REFUSALS.secret);
    expect(chat().turns.map((turn) => turn.role)).toEqual(["user"]);
  });

  test("a failed call says why, and the chat can go on", async () => {
    start();
    const model = fakeModel(() => Promise.reject(new Error("The Claude lane is signed out.")));
    await sendToLibrarian(
      "chat-1",
      { text: person("Tag it"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    expect(chat()).toMatchObject({ status: "idle", error: "The Claude lane is signed out." });
  });

  test("one message at a time, and a reply to a closed chat goes nowhere", async () => {
    start();
    let answer: (text: string) => void = () => undefined;
    const model = fakeModel(() => new Promise<string>((resolve) => (answer = resolve)));
    const first = sendToLibrarian(
      "chat-1",
      { text: person("One"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    // the send asks for the refusal first; wait until the model has the question
    while (model.sent.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chat().status).toBe("thinking");
    await sendToLibrarian(
      "chat-1",
      { text: person("Two"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    expect(chat().turns).toHaveLength(1);
    closeLibrarianChat();
    start("chat-2");
    answer("Late.");
    await first;
    expect(chat()).toMatchObject({ id: "chat-2", turns: [] });
  });
});

describe("applying a reply's proposals", () => {
  async function withProposal() {
    start();
    const model = fakeModel(
      'Done.\n{"actions":[{"type":"tag","tags":["person"]},{"type":"file","area":"people"}]}',
    );
    await sendToLibrarian(
      "chat-1",
      { text: person("Tag and file"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    return chat().turns[1]!;
  }

  test("the picked changes are applied, and the card says how many", async () => {
    const turn = await withProposal();
    const applied: unknown[] = [];
    await applyProposal(
      "chat-1",
      turn.id,
      [{ type: "tag", tags: ["person"] }],
      { id: "n1", title: "Maya Chen", model: MODEL.id },
      async (actions) => {
        applied.push(...actions);
        return actions.length;
      },
    );
    expect(applied).toEqual([{ type: "tag", tags: ["person"] }]);
    // the card keeps exactly what was applied, to list it in the chat
    expect(chat().turns[1]?.proposal).toEqual({
      kind: "applied",
      message: "1 change made.",
      done: [{ type: "tag", tags: ["person"] }],
    });
  });

  test("a refused apply keeps the choices and says why", async () => {
    const turn = await withProposal();
    await applyProposal(
      "chat-1",
      turn.id,
      [],
      { id: "n1", title: "Maya Chen", model: MODEL.id },
      async () => {
        throw new Error("This note is locked, so the Librarian won’t touch it.");
      },
    );
    expect(chat().turns[1]?.proposal).toEqual({ kind: "open", picked: [true, true] });
    expect(chat().error).toBe("This note is locked, so the Librarian won’t touch it.");
  });
});

describe("taking a request to Chat", () => {
  test("a request that isn't about organizing comes back offering Chat", async () => {
    start();
    const model = fakeModel('{"actions":[],"handoff":"chat"}');
    await sendToLibrarian(
      "chat-1",
      { text: person("Write a poem"), highlight: null },
      MODEL,
      context,
      allow,
      model.hostFor,
    );
    expect(chat().turns[1]).toMatchObject({
      role: "librarian",
      text: "That’s one for Chat. I only organize this note.",
      handoff: true,
    });
    expect(chat().turns[1]?.proposal).toBeUndefined();
  });

  test("the question goes to Chat typed, with the passage it was about", () => {
    expect(chatDraft({ text: person("Who is she?"), highlight: null })).toBe("Who is she?");
    expect(chatDraft({ text: person("Who is she?"), highlight: HIGHLIGHT })).toBe(
      "About “design meetup”:\n\nWho is she?",
    );
    expect(chatDraft(null)).toBe("");
  });

  test("the new chat tab gets the question typed into its composer", async () => {
    const opened = await takeToChat(
      "n1",
      { text: person("Write her an email"), highlight: null },
      async () => {
        usePanesStore.getState().openChat("chat-about-maya", { newTab: true });
        return true;
      },
    );
    expect(opened).toBe(true);
    const panes = usePanesStore.getState();
    const tab = findLeaf(panes.root, panes.focusedPaneId)?.tabs.find(
      (t) => t.surfaceKind === "chat" && t.chatSlug === "chat-about-maya",
    );
    expect(tab).toBeDefined();
    expect(useChatDrafts.getState().drafts[tab!.id]?.message).toBe("Write her an email");
  });

  test("a note that is gone opens nothing", async () => {
    expect(await takeToChat("gone", { text: person("x"), highlight: null }, async () => false)).toBe(false);
  });
});

describe("the Librarian's areas", () => {
  test("a Rotli vault's are the folders under wiki/, minus its lanes", () => {
    expect(
      libraryAreas<string>(["wiki", "wiki/Work", "wiki/_inbox", "wiki/Work/Clients", "chats"], null),
    ).toEqual(["Work"]);
  });

  test("a copy's are the person's own top-level folders, never the inbox or Rotli's", () => {
    const roles = IMPORTED_FOLDER_ROLES;
    const ids = ["Work", "Work/Clients", "Daily", roles.inbox, roles.trash, roles.chats, ".obsidian"];
    expect(libraryAreas<string>(ids, roles)).toEqual(["Work", "Daily"]);
  });
});
