import { describe, expect, test } from "bun:test";

import {
  CHAT_MEMORY_END,
  CHAT_MEMORY_START,
  CHAT_NOTES_HEADING,
  attachedNoteId,
  attachedNoteMatches,
  buildChatNotesPrompt,
  extractChatNotes,
  fallbackChatNotes,
  mergeChatMemory,
  pickChatNote,
  sanitizeChatNotes,
} from "./model";

describe("chat notes model", () => {
  test("a fresh note reads like notes — no comments, no blockquote, no transcript", () => {
    const body = mergeChatMemory("", "Project chat", "project-chat", "- We chose the cedar launch plan.");
    expect(body).toContain("# Project chat");
    expect(body).toContain("Notes from [[project-chat]].");
    expect(body).toContain(`${CHAT_NOTES_HEADING}\n\n- We chose the cedar launch plan.`);
    expect(body).not.toContain("<!--");
    expect(body).not.toContain("> chat:");
    expect(body).not.toContain("**User:**");
  });

  test("refreshes only the managed section and preserves user notes around it", () => {
    const first = mergeChatMemory("# T\n\nMy own notes.\n", "T", "c", "- old point");
    const withTail = `${first}\n## My section\n\nkeep me\n`;
    const next = mergeChatMemory(withTail, "T", "c", "- new point");
    expect(next).toContain("My own notes.");
    expect(next).toContain("keep me");
    expect(next).not.toContain("- old point");
    expect(next).toContain("- new point");
    expect(next.match(new RegExp(CHAT_NOTES_HEADING, "g"))?.length).toBe(1);
  });

  test("migrates a pre-0.46 comment-marker block and its > chat: line", () => {
    const legacy = [
      "# Chat",
      "",
      "> chat: [[my-chat]]",
      "",
      CHAT_MEMORY_START,
      "## Conversation memory",
      "",
      "- **User:** old transcript line",
      CHAT_MEMORY_END,
      "",
    ].join("\n");
    const next = mergeChatMemory(legacy, "Chat", "my-chat", "- the actual takeaway");
    expect(next).not.toContain(CHAT_MEMORY_START);
    expect(next).not.toContain("**User:**");
    expect(next).not.toContain("> chat:");
    expect(next).toContain("Notes from [[my-chat]].");
    expect(next).toContain(`${CHAT_NOTES_HEADING}\n\n- the actual takeaway`);
  });

  test("extractChatNotes returns the section content and null when absent", () => {
    const body = mergeChatMemory("", "T", "c", "- a point\n- another");
    expect(extractChatNotes(body)).toBe("- a point\n- another");
    expect(extractChatNotes("# T\n\njust prose\n")).toBeNull();
  });

  test("sanitizeChatNotes unwraps fences, demotes big headings, and rejects empties", () => {
    expect(sanitizeChatNotes("```markdown\n- a\n```")).toBe("- a");
    expect(sanitizeChatNotes("# Big\n## Also big\n### fine")).toBe("### Big\n### Also big\n### fine");
    expect(sanitizeChatNotes("   ")).toBeNull();
    expect(sanitizeChatNotes(null)).toBeNull();
  });

  test("the fallback digest is topics, never a speaker transcript", () => {
    const notes = fallbackChatNotes([
      { speaker: "you", text: "can we whitelabel fluidpay?" },
      { speaker: "rotli", text: "yes — here's how." },
    ]);
    expect(notes).toContain("### Topics discussed");
    expect(notes).toContain("- can we whitelabel fluidpay?");
    expect(notes).not.toContain("Rotli");
    expect(notes).not.toContain("**User:**");
  });

  test("the notes prompt carries current notes and the compacted conversation", () => {
    const prompt = buildChatNotesPrompt("- existing point", [
      { speaker: "you", text: "hello" },
      { speaker: "rotli", text: "hi" },
    ]);
    expect(prompt).toContain("- existing point");
    expect(prompt).toContain("User: hello");
    expect(prompt).toContain("Assistant: hi");
    expect(prompt).toContain("Never write a transcript");
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

describe("a chat's note among same-title notes (2026-09-17)", () => {
  test("attachedNoteMatches lists every note answering to the stem", () => {
    const notes = [
      { id: "01A", aliases: ["omachary-research", "omachary-research (3)"] },
      { id: "01B", aliases: ["omachary-research"] },
      { id: "01C", aliases: ["other"] },
    ];
    expect(attachedNoteMatches("omachary-research", notes).map((n) => n.id)).toEqual(["01A", "01B"]);
    expect(attachedNoteMatches("omachary-research (3)", notes).map((n) => n.id)).toEqual(["01A"]);
    expect(attachedNoteMatches("", notes)).toEqual([]);
    // the ambiguous case is exactly where attachedNoteId gives up
    expect(attachedNoteId("omachary-research", notes)).toBeNull();
  });

  test("pickChatNote prefers the note that links back to the chat, newest first", () => {
    expect(
      pickChatNote([
        { id: "user-note", updatedAt: 9, linksChat: false },
        { id: "older-memory", updatedAt: 1, linksChat: true },
        { id: "newer-memory", updatedAt: 5, linksChat: true },
      ]),
    ).toBe("newer-memory");
  });

  test("pickChatNote falls back to the newest when none links back, and to null for nothing", () => {
    expect(
      pickChatNote([
        { id: "a", updatedAt: 1, linksChat: false },
        { id: "b", updatedAt: 3, linksChat: false },
        { id: "c", linksChat: false },
      ]),
    ).toBe("b");
    expect(pickChatNote([])).toBeNull();
  });
});
