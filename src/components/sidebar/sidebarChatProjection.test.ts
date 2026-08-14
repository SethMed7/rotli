import { describe, expect, test } from "bun:test";

import { relativeChatAge, visibleSidebarChats } from "./sidebarChatProjection";

const chats = [{ slug: "one" }, { slug: "two" }];

describe("Chat-front projection", () => {
  test("an empty or legacy named view falls back to every saved chat", () => {
    expect(visibleSidebarChats(chats, [])).toEqual(chats);
    expect(visibleSidebarChats(chats, ["no-longer-present"])).toEqual(chats);
  });

  test("a named view with chat membership still narrows the list", () => {
    expect(visibleSidebarChats(chats, ["two"])).toEqual([{ slug: "two" }]);
    expect(visibleSidebarChats(chats, null)).toEqual(chats);
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
