import { describe, expect, test } from "bun:test";

import { visibleSidebarChats } from "./sidebarChatProjection";

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
