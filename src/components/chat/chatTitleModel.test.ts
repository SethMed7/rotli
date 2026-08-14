import { describe, expect, test } from "bun:test";

import {
  CHAT_TITLE_MAX_LENGTH,
  chatTitleAdvanceHint,
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

  test("explains whether Enter skips naming or continues", () => {
    expect(chatTitleAdvanceHint("   ")).toBe("Enter to skip");
    expect(chatTitleAdvanceHint("Research plan")).toBe("Enter to use");
  });
});
