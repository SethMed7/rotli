import { describe, expect, test } from "bun:test";
import {
  attachedNoteStem,
  findAttachedChatSlug,
  noteChatSlug,
  noteStemFromPath,
  secureNoteStem,
} from "./model";

describe("note chat identity", () => {
  test("derives a portable note stem from corpus and Windows-style paths", () => {
    expect(noteStemFromPath("vault:wiki/projects/rotli-ABC123.md")).toBe("rotli-ABC123");
    expect(noteStemFromPath("wiki\\projects\\brief-XYZ789.md")).toBe("brief-XYZ789");
  });

  test("reuses the chat already attached to the note", () => {
    const chats = [
      { slug: "other", attachedTo: "[[other-note]]" },
      { slug: "rotli", attachedTo: "[[rotli-ABC123]]" },
    ];
    expect(findAttachedChatSlug(chats, "rotli-ABC123")).toBe("rotli");
    expect(attachedNoteStem(chats[1]?.attachedTo)).toBe("rotli-ABC123");
  });

  test("makes a safe stable slug without leaking the id into the title", () => {
    expect(noteChatSlug("Launch Plan", "01JABCDEF0XYZ789")).toBe("chat-about-launch-plan-xyz789");
    expect(noteChatSlug("x".repeat(100), "ABC123").length).toBeLessThanOrEqual(59);
  });

  test("uses opaque attachment metadata for secure notes", () => {
    expect(secureNoteStem("01JABCDEF0XYZ789")).toBe("secure-note-xyz789");
  });
});
