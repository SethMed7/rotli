import { describe, expect, test } from "bun:test";
import {
  attachedNoteStem,
  findAttachedChats,
  findAttachedChatSlug,
  nextNoteChatSlug,
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

  test("lists every chat attached to a note, newest work first", () => {
    const chats = [
      { slug: "a", attachedTo: "[[rotli-ABC123]]", modifiedMs: 10 },
      { slug: "other", attachedTo: "[[other-note]]", modifiedMs: 99 },
      { slug: "b", attachedTo: "[[rotli-ABC123]]", modifiedMs: 30 },
      { slug: "c", attachedTo: "[[rotli-ABC123]]" }, // no timestamp → last
    ];
    expect(findAttachedChats(chats, "rotli-ABC123").map((c) => c.slug)).toEqual(["b", "a", "c"]);
    // the single-slug resolver now means "the most recently touched chat"
    expect(findAttachedChatSlug(chats, "rotli-ABC123")).toBe("b");
    expect(findAttachedChats(chats, "missing")).toEqual([]);
  });

  test("mints a fresh slug for each additional chat on the same note", () => {
    const base = noteChatSlug("Launch Plan", "01JABCDEF0XYZ789");
    expect(nextNoteChatSlug("Launch Plan", "01JABCDEF0XYZ789", [])).toBe(base);
    expect(nextNoteChatSlug("Launch Plan", "01JABCDEF0XYZ789", [base])).toBe(`${base}-2`);
    expect(nextNoteChatSlug("Launch Plan", "01JABCDEF0XYZ789", [base, `${base}-2`])).toBe(`${base}-3`);
    // holes are reused — a deleted middle chat's slug frees up
    expect(nextNoteChatSlug("Launch Plan", "01JABCDEF0XYZ789", [base, `${base}-3`])).toBe(`${base}-2`);
  });
});
