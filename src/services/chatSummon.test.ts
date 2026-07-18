// The pure half of ⌥A summon-chat: picking the chat to land in. The summon
// flow itself (window show, pane wiring) is Tauri-bound and smoke-tested live.

import { describe, expect, test } from "bun:test";

import { newestChatSlug } from "./chatSummon";

describe("newestChatSlug", () => {
  test("returns null for no chats", () => {
    expect(newestChatSlug([])).toBeNull();
  });

  test("picks the most recently touched chat", () => {
    expect(
      newestChatSlug([
        { slug: "alpha", modifiedMs: 100 },
        { slug: "zeta", modifiedMs: 300 },
        { slug: "mid", modifiedMs: 200 },
      ]),
    ).toBe("zeta");
  });

  test("keeps the list order on ties (slug-sorted Rust-side ⇒ deterministic)", () => {
    expect(
      newestChatSlug([
        { slug: "a-first", modifiedMs: 100 },
        { slug: "b-second", modifiedMs: 100 },
      ]),
    ).toBe("a-first");
  });

  test("tolerates the mtime-unreadable sentinel (0)", () => {
    expect(
      newestChatSlug([
        { slug: "broken", modifiedMs: 0 },
        { slug: "ok", modifiedMs: 1 },
      ]),
    ).toBe("ok");
    expect(newestChatSlug([{ slug: "only", modifiedMs: 0 }])).toBe("only");
  });
});
