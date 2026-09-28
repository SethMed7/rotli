import { beforeEach, describe, expect, test } from "bun:test";

import {
  type ChatTurn,
  closeLibrarianChat,
  type LibrarianChat,
  librarianQuestions,
  startLibrarianChat,
  updateLibrarianTurn,
  useLibrarianBar,
} from "./librarianBar";

const reply = (text: string, extra: Partial<ChatTurn> = {}): ChatTurn =>
  ({ id: crypto.randomUUID(), role: "librarian", text, raw: text, actions: [], ...extra }) as ChatTurn;
const asked = (text: string): ChatTurn => ({ id: crypto.randomUUID(), role: "user", text, highlight: null });

const chat = (turns: ChatTurn[], status: LibrarianChat["status"] = "idle"): LibrarianChat => ({
  id: "c1",
  paneId: "p1",
  noteId: "n1",
  modelId: "m",
  turns,
  status,
  error: null,
  minimized: true,
});

describe("the Librarian's open questions (the sidebar badge)", () => {
  test("proposals and questions about people waiting, and a reply that asks", () => {
    expect(librarianQuestions(null)).toBe(0);
    expect(librarianQuestions(chat([asked("hi"), reply("Filed it.")]))).toBe(0);
    expect(librarianQuestions(chat([asked("hi"), reply("Which Jim do you mean?")]))).toBe(1);
    // answering the question clears it
    expect(librarianQuestions(chat([reply("Which Jim?"), asked("Jim Ortiz")]))).toBe(0);
    // while the next reply is on its way, nothing is being asked
    expect(librarianQuestions(chat([asked("hi"), reply("Which Jim?")], "thinking"))).toBe(0);
    const busy = chat([
      reply("Tag it?", { proposal: { kind: "open", picked: [true] } }),
      reply("Done.", { proposal: { kind: "applied", message: "" } }),
      reply("Two people already have notes.", {
        asks: [{ kind: "open" }, { kind: "answered", yes: false, message: "" }, { kind: "open" }],
      }),
    ]);
    // an open card at the end is the question, not the reply's own words too
    expect(librarianQuestions(busy)).toBe(3);
  });
});

describe("changing one turn", () => {
  beforeEach(() => closeLibrarianChat());

  test("only the conversation it names, only the turn it names", () => {
    const one = reply("a");
    const two = reply("b");
    startLibrarianChat(chat([one, two]));
    updateLibrarianTurn("c1", two.id, () => ({ handedOff: true }));
    updateLibrarianTurn("other", one.id, () => ({ handedOff: true }));
    expect(useLibrarianBar.getState().chat?.turns.map((t) => !!t.handedOff)).toEqual([false, true]);
  });
});
