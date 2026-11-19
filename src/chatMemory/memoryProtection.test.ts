// Sixth review of pull request 267 (F6): a note made secure between the send
// and the memory pass. The pass's own read returned it as protected, but the
// write followed the send's earlier answer and put its notes into a new
// ordinary note. Protection now accumulates from every read in the pass
// before anything is composed or written.
import { expect, test } from "bun:test";

import { approved } from "../lib/promptText.fixtures";
import {
  type ChatMemoryNote,
  type ChatMemoryRepository,
  MEMORY_NOT_PROTECTED,
  syncChatMemory,
} from "./workflow";

const turnedSecure: ChatMemoryNote = {
  id: "attached",
  stem: "Harbor plan",
  body: "# Harbor plan\n\n## Conversation notes\n\nthe pilot's private schedule",
  revision: "r2",
  notes: approved("the pilot's private schedule"),
  secure: true, // the pass's own read: only an on-device model may read it now
  aiEditable: false, // a person wrote it, so the chat keeps a note of its own
};

function repository(own: ChatMemoryNote | null) {
  const created: { body: string; secure: boolean }[] = [];
  const updated: string[] = [];
  const repo: ChatMemoryRepository = {
    findByStem: async () => turnedSecure,
    findMemoryNote: async () => own,
    create: async (body, opts) => {
      created.push({ body, secure: opts?.secure === true });
      return {
        id: "new",
        stem: "new",
        body,
        revision: "r0",
        notes: null,
        aiEditable: true,
        secure: opts?.secure === true,
      };
    },
    update: async (id) => void updated.push(id),
    attach: async () => {},
    setMemoryNote: async () => {},
  };
  return { repo, created, updated };
}

const input = {
  title: "Harbor plan",
  chatSlug: "harbor",
  attachedStem: "Harbor plan",
  turns: [],
  protectedOnly: false, // what the send knew: nothing protected yet
};

test("F6: notes read from a note that turned secure go only into a secure note", async () => {
  const { repo, created } = repository(null);
  await syncChatMemory(repo, input);
  expect(created).toHaveLength(1);
  expect(created[0]!.secure).toBe(true);
});

test("F6: and never into the chat's existing ordinary note", async () => {
  const ordinary: ChatMemoryNote = {
    id: "own",
    stem: "own",
    body: "# own",
    revision: "r1",
    notes: null,
    aiEditable: true,
    secure: false,
  };
  const { repo, created, updated } = repository(ordinary);
  await expect(syncChatMemory(repo, input)).rejects.toThrow(MEMORY_NOT_PROTECTED);
  expect([created, updated]).toEqual([[], []]);
});
