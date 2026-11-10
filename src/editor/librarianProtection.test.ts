// Sixth review of pull request 267: a Librarian turn's protection is captured
// with the turn and travels with it to every write; no writer asks the
// conversation again. And secure People never reach the Librarian at all, so
// listing them can't mark a conversation into a dead end.
import { beforeEach, expect, test } from "bun:test";

import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import { approved, approvedRows, person } from "../lib/promptText.fixtures";
import type { ChatModelInfo } from "../lib/tauri";
import { closeLibrarianChat, useLibrarianBar } from "../state/librarianBar";
import { useLibrarianRules } from "../state/librarianRules";
import { NOT_WRITTEN } from "./librarianKeep";
import {
  type LibrarianReads,
  librarianContext,
  sendTyped,
  sendToLibrarian,
  startOver,
} from "./librarianSession";
import { allow, fakeModel, MODEL, NOTE, start } from "./librarianSession.fixtures";

const LOCAL: ChatModelInfo = {
  ...MODEL,
  id: "local-gemma",
  label: "Gemma (on this Mac)",
  provider: "ollama",
  endpoint: "http://127.0.0.1:11434",
  api: "generate",
};
const RULE = "Notes about the harbor go to Work";
const RULE_REPLY = `Noted.\n{"actions":[{"type":"rule","text":"${RULE}"}]}`;
const ask = (text: string) => ({ text: person(text), highlight: null });
const rules = () => useLibrarianRules.getState().rules.filing;

/** The gate's reads: the open note (marked when `noteOnDeviceOnly`), and a
 * People listing holding one secure person for the on-device reader. */
const reads = (noteOnDeviceOnly: boolean): LibrarianReads => ({
  flush: async () => {},
  note: async (id) => ({
    id,
    revision: "r1",
    text: approved(NOTE),
    body: approved(NOTE),
    title: approved("Maya Chen"),
    onDeviceOnly: noteOnDeviceOnly,
  }),
  listing: async (model) => ({
    folderIds: [approved("wiki/People")],
    people: approvedRows(
      model.id === LOCAL.id
        ? [
            {
              id: "protected-person",
              title: "Velmora",
              snippet: "",
              folderId: "wiki/People",
              diskFolderId: "wiki/People",
              createdAt: 0,
              updatedAt: 0,
              pinned: false,
              kind: "note" as const,
              onDeviceOnly: true,
            },
          ]
        : [],
    ),
  }),
});

beforeEach(() => {
  closeLibrarianChat();
  useLibrarianRules.getState().setRules(structuredClone(DEFAULT_LIBRARIAN_RULES));
});

test("F8: secure People are left out of the Librarian's listing, so listing them marks nothing", async () => {
  const ctx = await librarianContext("n1", LOCAL, reads(false));
  expect(JSON.stringify(ctx.known)).not.toContain("Velmora");
  expect(ctx.onDeviceOnly).toBe(false);
});

test("F4: a marked conversation closed while its reply is on the way writes nothing", async () => {
  start();
  let answer!: (reply: string) => void;
  const local = fakeModel(() => new Promise<string>((resolve) => (answer = resolve)));
  const sent = sendToLibrarian(
    "chat-1",
    ask("Remember the harbor rule"),
    LOCAL,
    (m) => librarianContext("n1", m, reads(true)),
    allow,
    local.hostFor,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  closeLibrarianChat(); // closed while the reply is pending
  answer(RULE_REPLY);
  await sent;
  expect(rules()).not.toContain(RULE);
});

test("F4: replaced by a new conversation while the reply is on the way, the old turn writes nothing", async () => {
  start();
  let answer!: (reply: string) => void;
  const local = fakeModel(() => new Promise<string>((resolve) => (answer = resolve)));
  const sent = sendToLibrarian(
    "chat-1",
    ask("Remember the harbor rule"),
    LOCAL,
    (m) => librarianContext("n1", m, reads(true)),
    allow,
    local.hostFor,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  startOver(useLibrarianBar.getState().chat!, LOCAL.id, ""); // an unmarked conversation takes its place
  answer(RULE_REPLY);
  await sent;
  expect(rules()).not.toContain(RULE);
});

test("F8: a turn that read protected content offers a restart that works, without that context", async () => {
  start();
  const local = fakeModel(RULE_REPLY);
  await sendToLibrarian(
    "chat-1",
    ask("Remember the harbor rule"),
    LOCAL,
    (m) => librarianContext("n1", m, reads(true)),
    allow,
    local.hostFor,
  );
  const chat = useLibrarianBar.getState().chat!;
  expect(rules()).not.toContain(RULE);
  expect(chat.turns[1]!.kept).toEqual({ kind: "kept", lines: [{ text: NOT_WRITTEN, failed: true }] });
  expect(chat.restartWith).toBe(LOCAL.id); // the button shows
  startOver(chat, chat.restartWith!, "");
  const fresh = useLibrarianBar.getState().chat!;
  expect([fresh.turns.length, fresh.onDeviceOnly]).toEqual([0, undefined]);
  // the new conversation, about content nobody protected, keeps the vault
  await sendToLibrarian(
    fresh.id,
    ask("Remember the harbor rule"),
    LOCAL,
    (m) => librarianContext("n1", m, reads(false)),
    allow,
    fakeModel(RULE_REPLY).hostFor,
  );
  expect(rules()).toContain(RULE);
});

test("F10: a refused question is kept exactly as typed", async () => {
  start();
  await sendToLibrarian(
    "chat-1",
    ask("Mark it"),
    LOCAL,
    (m) => librarianContext("n1", m, reads(true)),
    allow,
    fakeModel("Done.").hostFor,
  );
  const typed = "  What about the harbor lease?\n";
  await sendTyped(
    "chat-1",
    typed,
    null,
    MODEL,
    (m) => librarianContext("n1", m, reads(true)),
    allow,
    fakeModel("No.").hostFor,
  );
  const chat = useLibrarianBar.getState().chat!;
  expect(chat.draft).toBe(typed);
  // a sent question joins the conversation trimmed, all the same
  await sendTyped(
    "chat-1",
    "  Next?  ",
    null,
    LOCAL,
    (m) => librarianContext("n1", m, reads(true)),
    allow,
    fakeModel("Yes.").hostFor,
  );
  expect(
    useLibrarianBar
      .getState()
      .chat!.turns.filter((turn) => turn.role === "user")
      .map((turn) => String(turn.text)),
  ).toContain("Next?");
});
