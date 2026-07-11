import { describe, expect, test } from "bun:test";
import { syncChatMemory, type ChatMemoryRepository } from "./workflow";

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
    expect(calls).toEqual(["create", "attach"]);
  });

  test("updates an existing note idempotently", async () => {
    let body = "# Chat\n";
    let updates = 0;
    const repository: ChatMemoryRepository = {
      findByStem: async () => ({ id: "n", stem: "chat-abc123", body }),
      create: async () => { throw new Error("should not create"); },
      update: async (_id, next) => { body = next; updates += 1; },
      attach: async () => {},
    };
    const input = { title: "Chat", chatSlug: "chat", attachedStem: "chat-abc123", turns: [{ speaker: "you", text: "fact" }] };
    await syncChatMemory(repository, input);
    await syncChatMemory(repository, input);
    expect(updates).toBe(1);
  });
});
