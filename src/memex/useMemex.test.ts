import { describe, expect, test } from "bun:test";

import { memexKeys } from "./useMemex";

describe("memex query keys", () => {
  test("no vault keys chats apart from every real instance id", () => {
    expect(memexKeys.chats(null)).toEqual(["memex", "chats", null]);
    expect(memexKeys.chats(null)).not.toEqual(memexKeys.chats("none"));
    expect(memexKeys.chats("v1")).toEqual(["memex", "chats", "v1"]);
  });
});
