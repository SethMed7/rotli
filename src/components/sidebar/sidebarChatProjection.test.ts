import { describe, expect, test } from "bun:test";

import { chatRowSignal, relativeChatAge } from "./sidebarChatProjection";

describe("chat row signal", () => {
  test("a live run reads Working and an unseen answer reads Unread reply", () => {
    expect(chatRowSignal("running")).toEqual({ kind: "working", label: "Working" });
    expect(chatRowSignal("unread")).toEqual({ kind: "unread", label: "Unread reply" });
  });

  test("an acknowledged or never-run chat carries no signal", () => {
    expect(chatRowSignal("done")).toBeNull();
    expect(chatRowSignal(undefined)).toBeNull();
  });
});

describe("relative chat activity", () => {
  const now = Date.UTC(2026, 7, 12, 20);

  test("uses compact stable labels without pretending future timestamps are old", () => {
    expect(relativeChatAge(now, now + 60_000)).toBe("now");
    expect(relativeChatAge(now, now - 20_000)).toBe("now");
    expect(relativeChatAge(now, now - 55 * 60_000)).toBe("55m");
    expect(relativeChatAge(now, now - 23 * 3_600_000)).toBe("23h");
    expect(relativeChatAge(now, now - 8 * 86_400_000)).toBe("8d");
  });
});
