import { beforeEach, describe, expect, test } from "bun:test";

import type { CompleteReq } from "../ai/types";
import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import type { ChatModelInfo } from "../lib/tauri";
import { LIBRARIAN_REFUSALS } from "../services/librarianBar";
import { useChatDrafts } from "../state/chatDrafts";
import { closeLibrarianChat, startLibrarianChat, useLibrarianBar } from "../state/librarianBar";
import { usePanesStore } from "../state/panes";
import { findLeaf } from "../state/paneTree";
import { applyProposal, chatDraft, sendToLibrarian, takeToChat } from "./librarianSession";

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
const context = async () => ({
  title: "Maya Chen",
  doc: NOTE,
  areas: ["people"],
  tags: [],
  people: ["People"],
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

beforeEach(() => closeLibrarianChat());

describe("a conversation with the Librarian", () => {
  test("a message joins the chat, and the reply comes back with its proposals ready to apply", async () => {
    start();
    const model = fakeModel('She is someone you met.\n{"actions":[{"type":"file","area":"people"}]}');
    await sendToLibrarian(
      "chat-1",
      { text: "Who is this?", highlight: HIGHLIGHT },
      MODEL,
      context,
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
    await sendToLibrarian("chat-1", { text: "First", highlight: null }, MODEL, context, model.hostFor);
    await sendToLibrarian("chat-1", { text: "Second", highlight: null }, MODEL, context, model.hostFor);
    expect(model.sent[1]?.map((message) => [message.role, message.content])).toEqual([
      ["system", expect.stringContaining("Met Maya at the design meetup.")],
      ["user", "First"],
      ["assistant", "Noted."],
      ["user", "Second"],
    ]);
    // a reply with nothing to organize has nothing to apply
    expect(chat().turns[1]?.proposal).toBeUndefined();
  });

  test("a secret in the conversation is refused before anything is sent", async () => {
    start();
    const model = fakeModel("never");
    await sendToLibrarian(
      "chat-1",
      { text: "my key is sk-ant-abcdefghijklmnopqrstuvwx", highlight: null },
      MODEL,
      context,
      model.hostFor,
    );
    expect(model.sent).toHaveLength(0);
    expect(chat().error).toBe(LIBRARIAN_REFUSALS.secret);
    expect(chat().turns.map((turn) => turn.role)).toEqual(["user"]);
  });

  test("a failed call says why, and the chat can go on", async () => {
    start();
    const model = fakeModel(() => Promise.reject(new Error("The Claude lane is signed out.")));
    await sendToLibrarian("chat-1", { text: "Tag it", highlight: null }, MODEL, context, model.hostFor);
    expect(chat()).toMatchObject({ status: "idle", error: "The Claude lane is signed out." });
  });

  test("one message at a time, and a reply to a closed chat goes nowhere", async () => {
    start();
    let answer: (text: string) => void = () => undefined;
    const model = fakeModel(() => new Promise<string>((resolve) => (answer = resolve)));
    const first = sendToLibrarian("chat-1", { text: "One", highlight: null }, MODEL, context, model.hostFor);
    await Promise.resolve();
    expect(chat().status).toBe("thinking");
    await sendToLibrarian("chat-1", { text: "Two", highlight: null }, MODEL, context, model.hostFor);
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
    await sendToLibrarian("chat-1", { text: "Tag and file", highlight: null }, MODEL, context, model.hostFor);
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
    expect(chat().turns[1]?.proposal).toEqual({ kind: "applied", message: "1 change made." });
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
    await sendToLibrarian("chat-1", { text: "Write a poem", highlight: null }, MODEL, context, model.hostFor);
    expect(chat().turns[1]).toMatchObject({
      role: "librarian",
      text: "That’s one for Chat. I only organize this note.",
      handoff: true,
    });
    expect(chat().turns[1]?.proposal).toBeUndefined();
  });

  test("the question goes to Chat typed, with the passage it was about", () => {
    expect(chatDraft({ text: "Who is she?", highlight: null })).toBe("Who is she?");
    expect(chatDraft({ text: "Who is she?", highlight: HIGHLIGHT })).toBe(
      "About “design meetup”:\n\nWho is she?",
    );
    expect(chatDraft(null)).toBe("");
  });

  test("the new chat tab gets the question typed into its composer", async () => {
    const opened = await takeToChat("n1", { text: "Write her an email", highlight: null }, async () => {
      usePanesStore.getState().openChat("chat-about-maya", { newTab: true });
      return true;
    });
    expect(opened).toBe(true);
    const panes = usePanesStore.getState();
    const tab = findLeaf(panes.root, panes.focusedPaneId)?.tabs.find(
      (t) => t.surfaceKind === "chat" && t.chatSlug === "chat-about-maya",
    );
    expect(tab).toBeDefined();
    expect(useChatDrafts.getState().drafts[tab!.id]?.message).toBe("Write her an email");
  });

  test("a note that is gone opens nothing", async () => {
    expect(await takeToChat("gone", { text: "x", highlight: null }, async () => false)).toBe(false);
  });
});
