import { describe, expect, test } from "bun:test";

import { CHAT_NOTES_HEADING } from "./model";
import { syncChatMemory, type ChatMemoryRepository } from "./workflow";

describe("syncChatMemory", () => {
  test("creates and attaches the one background note when absent", async () => {
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => null,
      create: async (body) => (
        calls.push("create"),
        { id: "n", stem: "chat-abc123", body, revision: "r1", aiEditable: true }
      ),
      update: async () => void calls.push("update"),
      attach: async () => void calls.push("attach"),
      findMemoryNote: async () => null,
      setMemoryNote: async () => void calls.push("setMemoryNote"),
    };
    const note = await syncChatMemory(repository, {
      title: "Chat",
      chatSlug: "chat",
      turns: [{ speaker: "you", text: "remember this" }],
    });
    expect(note?.body).toContain("remember this");
    expect(note?.body).toContain(CHAT_NOTES_HEADING);
    expect(calls).toEqual(["create", "attach"]);
  });

  test("an ATTACHED chat whose note can't be resolved gets NO new note", async () => {
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => null, // the attached note is out of this listing's reach
      create: async (body) => (
        calls.push("create"),
        { id: "n", stem: "memory-note", body, revision: "r1", aiEditable: true }
      ),
      update: async () => void calls.push("update"),
      attach: async () => void calls.push("attach"),
      findMemoryNote: async () => null,
      setMemoryNote: async () => void calls.push("setMemoryNote"),
    };
    const note = await syncChatMemory(repository, {
      title: "Chat",
      chatSlug: "chat",
      attachedStem: "the-note-this-chat-was-opened-from",
      turns: [{ speaker: "you", text: "a turn" }],
    });
    // neither "create" (a fresh note beside the pointer every turn — the
    // 2026-09-17 duplicate factory) nor "attach" (re-pointing would orphan the
    // chat from its note; the editor's chat chip lists a note's chats by
    // exactly that pointer): the pointer stays and the turn writes nothing
    expect(calls).toEqual([]);
    expect(note).toBeNull();
  });

  test("updates an existing note idempotently", async () => {
    let body = "# Chat\n";
    let updates = 0;
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({ id: "n", stem: "chat-abc123", body, revision: "r1", aiEditable: true }),
      create: async () => {
        throw new Error("should not create");
      },
      update: async (_id, next) => {
        body = next;
        updates += 1;
      },
      attach: async () => {},
      findMemoryNote: async () => null,
      setMemoryNote: async () => {},
    };
    const input = {
      title: "Chat",
      chatSlug: "chat",
      attachedStem: "chat-abc123",
      turns: [{ speaker: "you", text: "fact" }],
    };
    await syncChatMemory(repository, input);
    await syncChatMemory(repository, input);
    expect(updates).toBe(1);
  });

  test("a model composes the notes; its output is sanitized into the section", async () => {
    const repository: ChatMemoryRepository = {
      findByStem: async () => null,
      create: async (body) => ({ id: "n", stem: "s", body, revision: "r1", aiEditable: true }),
      update: async () => {},
      attach: async () => {},
      findMemoryNote: async () => null,
      setMemoryNote: async () => {},
    };
    const note = await syncChatMemory(repository, {
      title: "Chat",
      chatSlug: "chat",
      turns: [{ speaker: "you", text: "topic" }],
      composeNotes: async ({ currentNotes }) => {
        expect(currentNotes).toBeNull();
        return "```markdown\n## Decisions\n- ship it\n```";
      },
    });
    expect(note?.body).toContain("### Decisions");
    expect(note?.body).toContain("- ship it");
    expect(note?.body).not.toContain("```");
  });

  test("a failed or empty model call keeps existing notes instead of wiping them", async () => {
    let body = `# Chat\n\nNotes from [[chat]].\n\n${CHAT_NOTES_HEADING}\n\n- the kept point\n`;
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({ id: "n", stem: "s", body, revision: "r1", aiEditable: true }),
      create: async () => {
        throw new Error("should not create");
      },
      update: async (_id, next) => {
        body = next;
      },
      attach: async () => {},
      findMemoryNote: async () => null,
      setMemoryNote: async () => {},
    };
    await syncChatMemory(repository, {
      title: "Chat",
      chatSlug: "chat",
      attachedStem: "s",
      turns: [{ speaker: "you", text: "new turn" }],
      composeNotes: async () => {
        throw new Error("model down");
      },
    });
    expect(body).toContain("- the kept point");
    await syncChatMemory(repository, {
      title: "Chat",
      chatSlug: "chat",
      attachedStem: "s",
      turns: [{ speaker: "you", text: "new turn" }],
      composeNotes: async () => "   ",
    });
    expect(body).toContain("- the kept point");
  });

  // 2026-09-29: a chat attached to a note the PERSON wrote never writes into
  // it. Its notes live in a chat-made note of its own, seeded from whatever
  // notes the person's note already carried (reading is fine; writing isn't).
  test("a person's note is read but never written; the chat keeps its own note", async () => {
    const calls: string[] = [];
    const personal = `# My plan\n\nMine.\n\n${CHAT_NOTES_HEADING}\n\n- earlier point\n`;
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({
        id: "p",
        stem: "my-plan",
        body: personal,
        revision: "r1",
        aiEditable: false,
      }),
      create: async (body) => (
        calls.push("create"),
        { id: "m", stem: "chat-notes", body, revision: "r1", aiEditable: true }
      ),
      update: async (id) => void calls.push(`update ${id}`),
      attach: async () => void calls.push("attach"),
      findMemoryNote: async () => null,
      setMemoryNote: async (stem) => void calls.push(`setMemoryNote ${stem}`),
    };
    const note = await syncChatMemory(repository, {
      title: "My plan",
      chatSlug: "chat",
      attachedStem: "my-plan",
      turns: [{ speaker: "you", text: "a turn" }],
    });
    expect(calls).toEqual(["create", "setMemoryNote chat-notes"]);
    expect(note?.id).toBe("m");
    expect(note?.body).toContain("- earlier point");
  });

  test("once the chat has its own note, later turns update only that note", async () => {
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({
        id: "p",
        stem: "my-plan",
        body: "# My plan\n",
        revision: "r1",
        aiEditable: false,
      }),
      create: async () => {
        throw new Error("should not create");
      },
      update: async (id) => void calls.push(`update ${id}`),
      attach: async () => void calls.push("attach"),
      findMemoryNote: async () => ({
        id: "m",
        stem: "chat-notes",
        body: "# Chat\n",
        revision: "r2",
        aiEditable: true,
      }),
      setMemoryNote: async () => void calls.push("setMemoryNote"),
    };
    await syncChatMemory(repository, {
      title: "My plan",
      chatSlug: "chat",
      attachedStem: "my-plan",
      turns: [{ speaker: "you", text: "another turn" }],
    });
    expect(calls).toEqual(["update m"]);
  });

  test("when the person turned AI editing off on the chat's own note, nothing is written", async () => {
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({
        id: "p",
        stem: "my-plan",
        body: "# My plan\n",
        revision: "r1",
        aiEditable: false,
      }),
      create: async () => (
        calls.push("create"),
        { id: "x", stem: "x", body: "", revision: "r", aiEditable: true }
      ),
      update: async (id) => void calls.push(`update ${id}`),
      attach: async () => void calls.push("attach"),
      findMemoryNote: async () => ({
        id: "m",
        stem: "chat-notes",
        body: "# Chat\n",
        revision: "r2",
        aiEditable: false,
      }),
      setMemoryNote: async () => void calls.push("setMemoryNote"),
    };
    const note = await syncChatMemory(repository, {
      title: "My plan",
      chatSlug: "chat",
      attachedStem: "my-plan",
      turns: [{ speaker: "you", text: "turn" }],
    });
    expect(calls).toEqual([]);
    expect(note).toBeNull();
  });
});

// the pull-request review (2026-09-29): a memory note from before provenance can carry the person's
// own edits inside the notes section, which no shape check can tell apart, so
// it is read for its notes and never written.
describe("an older memory note a person edited", () => {
  test("is read, never written; the chat starts its own note", async () => {
    const edited = `# Plan\n\nNotes from [[plan]].\n\n${CHAT_NOTES_HEADING}\n\n- ship it (my own wording)\n`;
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({ id: "old", stem: "plan", body: edited, revision: "r1", aiEditable: false }),
      create: async (body) => (
        calls.push("create"),
        { id: "new", stem: "plan-notes", body, revision: "r1", aiEditable: true }
      ),
      update: async (id) => void calls.push(`update ${id}`),
      attach: async () => void calls.push("attach"),
      findMemoryNote: async () => null,
      setMemoryNote: async (stem) => void calls.push(`setMemoryNote ${stem}`),
    };
    const note = await syncChatMemory(repository, {
      title: "Plan",
      chatSlug: "plan",
      attachedStem: "plan",
      turns: [{ speaker: "you", text: "turn" }],
    });
    expect(calls).toEqual(["create", "setMemoryNote plan-notes"]);
    expect(note?.body).toContain("- ship it (my own wording)");
  });
});
