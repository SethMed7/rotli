// Chat's tag_note (2026-11-24) through the real host: the same gates as
// update_note before the AI tag lane, which Rust enforces again. Mocked
// corpus bridge (host.fixtures.ts); Rust's own lane is corpus_tags_tests.rs.

import { beforeEach, expect, test } from "bun:test";

import type { EditRequest } from "./editGate";
import { fake, FRONTIER, LOCAL, tagWrites } from "./host.fixtures";

const { makeTauriHost } = await import("./host");

beforeEach(() => {
  fake.probeThrows = false;
  tagWrites.length = 0;
  fake.rows = [
    { id: "agent-note", title: "Agent note", body: "# Agent note\n\nplain", folderId: "Inbox" },
    {
      id: "mine",
      title: "Journal",
      body: "# Journal\n\nentries",
      folderId: "Inbox",
      aiBodyEdit: "person-written",
    },
    { id: "locked", title: "Locked", body: "# Locked\n\nx", folderId: "Inbox", locked: true },
    { id: "vault", title: "Safe", body: "# Safe\n\nsealed", folderId: "Inbox", secure: true },
  ];
});

test("a model tags a note it may edit, through the AI tag lane with its identity", async () => {
  const answer = await makeTauriHost(FRONTIER).tagNote!("agent-note", ["launch", "q3"], ["old"]);
  expect(answer).toMatch(/^tagged note agent-note/);
  expect(answer).toContain("#launch #q3");
  expect(tagWrites).toEqual([
    { id: "agent-note", change: { add: ["launch", "q3"], remove: ["old"] }, modelId: FRONTIER.id },
  ]);
});

test("a locked note and a secure one are refused for a remote model, and nothing is written", async () => {
  const host = makeTauriHost(FRONTIER);
  expect(await host.tagNote!("locked", ["x"], [])).toMatch(/^(blocked: )?.*locked/i);
  expect(await host.tagNote!("vault", ["x"], [])).toMatch(/^blocked:/);
  expect(tagWrites).toEqual([]);
});

test("a person's note asks first: no keeps it, Allow once tags it once", async () => {
  const asked: EditRequest[] = [];
  const refusing = makeTauriHost(LOCAL, {
    confirmEdit: async (request) => {
      asked.push(request);
      return "no";
    },
  });
  expect(await refusing.tagNote!("mine", ["x"], [])).not.toMatch(/^tagged/);
  expect(tagWrites).toEqual([]);
  expect(asked.map((request) => request.id)).toEqual(["mine"]);

  const once = makeTauriHost(LOCAL, { confirmEdit: async () => "once" });
  expect(await once.tagNote!("mine", ["x"], [])).toMatch(/^tagged/);
  expect(tagWrites).toEqual([
    { id: "mine", change: { add: ["x"], remove: [] }, modelId: LOCAL.id, consented: true },
  ]);
});

test("a chat carrying secure content may not tag an open note", async () => {
  const host = makeTauriHost(LOCAL, { isSecureContext: () => true });
  expect(await host.tagNote!("agent-note", ["x"], [])).toMatch(
    /^blocked: this chat carries secure-note content/,
  );
  expect(tagWrites).toEqual([]);
});
