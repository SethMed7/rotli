import { describe, expect, test } from "bun:test";

import {
  CHAT_TITLE_MAX_LENGTH,
  CHAT_TITLE_PLACEHOLDER,
  deriveChatTitle,
  normalizeChatTitle,
} from "./chatTitleModel";

describe("chat title model", () => {
  test("normalizes whitespace and caps user-entered titles", () => {
    expect(normalizeChatTitle("  A   small\nchat  ")).toBe("A small chat");
    expect(normalizeChatTitle("x".repeat(CHAT_TITLE_MAX_LENGTH + 20))).toHaveLength(CHAT_TITLE_MAX_LENGTH);
  });

  test("derives a compact title from the first message", () => {
    expect(deriveChatTitle("one two three four five six seven eight")).toBe("one two three four five six");
    expect(deriveChatTitle("   ")).toBe("New chat");
  });

  test("never names a chat after its image tags", () => {
    expect(deriveChatTitle("[Image #1]\nWhat does this show?")).toBe("What does this show?");
    expect(deriveChatTitle("[Image #1](storage:chat/a.png) compare with [Image #2] please")).toBe(
      "compare with please",
    );
    expect(deriveChatTitle("[Image #1] [Image #2]")).toBe("New chat");
  });

  test("keeps the skip instruction inside the pristine input placeholder", () => {
    expect(CHAT_TITLE_PLACEHOLDER).toBe("Name this chat (optional) · Enter to skip");
  });
});
