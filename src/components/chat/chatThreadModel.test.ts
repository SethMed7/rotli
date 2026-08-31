import { describe, expect, test } from "bun:test";

import { CHAT_MESSAGE_WINDOW, recentChatThread } from "./chatThreadModel";

describe("long chat thread window", () => {
  test("mounts only the newest messages while reporting what remains on disk", () => {
    const transcript = Array.from({ length: 10_000 }, (_, index) => `message-${index}`);
    const window = recentChatThread(transcript);

    expect(window.messages).toHaveLength(CHAT_MESSAGE_WINDOW);
    expect(window.hiddenCount).toBe(9_500);
    expect(window.messages[0]).toBe("message-9500");
    expect(window.messages.at(-1)).toBe("message-9999");
    expect(transcript).toHaveLength(10_000);
  });

  test("leaves an ordinary short thread intact", () => {
    expect(recentChatThread(["one", "two"])).toEqual({ messages: ["one", "two"], hiddenCount: 0 });
  });
});
