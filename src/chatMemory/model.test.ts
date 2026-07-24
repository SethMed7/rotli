import { describe, expect, test } from "bun:test";
import { CHAT_MEMORY_END, CHAT_MEMORY_START, attachedNoteId, mergeChatMemory } from "./model";

describe("chat memory model", () => {
  test("creates one searchable managed summary block", () => {
    const body = mergeChatMemory("", "Project chat", "project-chat", [
      { speaker: "you", text: "We chose the cedar launch plan." },
      { speaker: "rotli", text: "I captured the July deadline and owner." },
    ]);
    expect(body).toContain("# Project chat");
    expect(body).toContain("> chat: [[project-chat]]");
    expect(body).toContain("cedar launch plan");
    expect(body.match(new RegExp(CHAT_MEMORY_START, "g"))?.length).toBe(1);
  });

  test("refreshes only the managed block and preserves user notes", () => {
    const first = mergeChatMemory("# T\n\nMy own notes.\n", "T", "c", [{ speaker: "you", text: "old" }]);
    const next = mergeChatMemory(first, "T", "c", [{ speaker: "you", text: "new" }]);
    expect(next).toContain("My own notes.");
    expect(next).not.toContain("**User:** old");
    expect(next).toContain("**User:** new");
    expect(next.match(new RegExp(CHAT_MEMORY_END, "g"))?.length).toBe(1);
  });

  test("resolves a readable filename stem through note aliases", () => {
    expect(
      attachedNoteId("project-chat (2)", [
        { id: "01NEW", aliases: ["project-chat (2)", "project-chat"] },
        { id: "01OTHER", aliases: ["other"] },
      ]),
    ).toBe("01NEW");
  });

  test("keeps the legacy stable-id-tail attachment fallback", () => {
    expect(attachedNoteId("project-abc123", [{ id: "vault:01ABCDEFGHABC123" }, { id: "other" }])).toBe(
      "vault:01ABCDEFGHABC123",
    );
  });
});
