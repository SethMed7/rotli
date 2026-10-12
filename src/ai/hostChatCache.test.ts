import { expect, test } from "bun:test";

import { CHAT_MEMORY_WINDOW, touchBounded } from "./host";

const entry = (body: string) => ({ modifiedMs: 1, body });
const bounds = (entries: number, chars: number) => ({ entries, chars });

test("the chat body cache holds no more chats than memory search reads", () => {
  expect(CHAT_MEMORY_WINDOW).toBe(100);
  const cache = new Map<string, ReturnType<typeof entry>>();
  for (let i = 0; i < CHAT_MEMORY_WINDOW + 20; i++) touchBounded(cache, `c${i}`, entry("x"));
  expect(cache.size).toBe(CHAT_MEMORY_WINDOW);
  expect(cache.has("c19")).toBe(false);
  expect(cache.has("c20")).toBe(true);
  // and no more than 8M characters of transcript in total
  touchBounded(cache, "big", entry("b".repeat(7_999_950)));
  expect(cache.size).toBe(51);
});

test("a character budget evicts the oldest bodies first", () => {
  const cache = new Map<string, ReturnType<typeof entry>>();
  touchBounded(cache, "a", entry("aaaa"), bounds(10, 10));
  touchBounded(cache, "b", entry("bbbb"), bounds(10, 10));
  touchBounded(cache, "c", entry("cccc"), bounds(10, 10));
  expect([...cache.keys()]).toEqual(["b", "c"]);
  // a single body over budget is never kept
  touchBounded(cache, "huge", entry("h".repeat(11)), bounds(10, 10));
  expect(cache.size).toBe(0);
});

test("re-touching a key refreshes its place, so the untouched one goes first", () => {
  const cache = new Map<string, ReturnType<typeof entry>>();
  touchBounded(cache, "a", entry("1"), bounds(2, 100));
  touchBounded(cache, "b", entry("2"), bounds(2, 100));
  touchBounded(cache, "a", entry("1"), bounds(2, 100));
  touchBounded(cache, "c", entry("3"), bounds(2, 100));
  expect([...cache.keys()]).toEqual(["a", "c"]);
});
