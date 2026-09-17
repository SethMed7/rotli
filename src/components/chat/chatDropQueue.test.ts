import { expect, test } from "bun:test";

import { onChatAttachment, queueChatAttachment, takeChatAttachment } from "./chatDropQueue";

test("a queued drop is taken once, by its chat, in order", () => {
  queueChatAttachment("a", ["/one.png"], 1000);
  queueChatAttachment("a", ["/two.png"], 1500);
  queueChatAttachment("b", ["/other.png"], 1000);
  expect(takeChatAttachment("a", 2000)).toEqual(["/one.png", "/two.png"]);
  expect(takeChatAttachment("a", 2000)).toBeNull();
  expect(takeChatAttachment("b", 2000)).toEqual(["/other.png"]);
});

test("paths older than their import grants are dropped, not handed over", () => {
  queueChatAttachment("stale", ["/old.png"], 0);
  expect(takeChatAttachment("stale", 60_000)).toBeNull();
  queueChatAttachment("mixed", ["/old.png"], 0);
  queueChatAttachment("mixed", ["/new.png"], 60_000);
  expect(takeChatAttachment("mixed", 61_000)).toEqual(["/new.png"]);
  expect(takeChatAttachment("nothing")).toBeNull();
  queueChatAttachment("empty", []);
  expect(takeChatAttachment("empty")).toBeNull();
});

test("a composer that is already open is told when paths arrive, and only for its chat", () => {
  const heard: string[] = [];
  const stopA = onChatAttachment("open-a", () => heard.push("a"));
  const stopB = onChatAttachment("open-b", () => heard.push("b"));
  queueChatAttachment("open-a", ["/one.png"]);
  expect(heard).toEqual(["a"]);
  expect(takeChatAttachment("open-a")).toEqual(["/one.png"]);
  stopA();
  queueChatAttachment("open-a", ["/two.png"]);
  queueChatAttachment("open-b", ["/three.png"]);
  expect(heard).toEqual(["a", "b"]);
  stopB();
  expect(takeChatAttachment("open-a")).toEqual(["/two.png"]);
  expect(takeChatAttachment("open-b")).toEqual(["/three.png"]);
});
