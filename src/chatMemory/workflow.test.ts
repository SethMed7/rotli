import { describe, expect, test } from "bun:test";
import { syncChatMemory, type ChatMemoryRepository } from "./workflow";
import { CHAT_NOTES_HEADING } from "./model";

describe("syncChatMemory", () => {
  test("creates and attaches the one background note when absent", async () => {
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => null,
      create: async (body) => (calls.push("create"), { id: "n", stem: "chat-abc123", body }),
      update: async () => void calls.push("update"),
      attach: async () => void calls.push("attach"),
    };
    const note = await syncChatMemory(repository, {
      title: "Chat",
      chatSlug: "chat",
      turns: [{ speaker: "you", text: "remember this" }],
    });
    expect(note.body).toContain("remember this");
    expect(note.body).toContain(CHAT_NOTES_HEADING);
    expect(calls).toEqual(["create", "attach"]);
  });

  test("updates an existing note idempotently", async () => {
    let body = "# Chat\n";
    let updates = 0;
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({ id: "n", stem: "chat-abc123", body }),
      create: async () => {
        throw new Error("should not create");
      },
      update: async (_id, next) => {
        body = next;
        updates += 1;
      },
      attach: async () => {},
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
      create: async (body) => ({ id: "n", stem: "s", body }),
      update: async () => {},
      attach: async () => {},
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
    expect(note.body).toContain("### Decisions");
    expect(note.body).toContain("- ship it");
    expect(note.body).not.toContain("```");
  });

  test("a failed or empty model call keeps existing notes instead of wiping them", async () => {
    let body = `# Chat\n\nNotes from [[chat]].\n\n${CHAT_NOTES_HEADING}\n\n- the kept point\n`;
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({ id: "n", stem: "s", body }),
      create: async () => {
        throw new Error("should not create");
      },
      update: async (_id, next) => {
        body = next;
      },
      attach: async () => {},
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
});
