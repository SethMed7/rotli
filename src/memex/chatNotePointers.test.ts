import { describe, expect, test } from "bun:test";

import { chatMemoryNote, setChatMemoryNote } from "./chatNotePointers";

const CHAT =
  "---\nid: c1\ntitle: Plan\nattachedTo: [[my-plan]]\n---\n\n## Messages\nmemoryNote: [[not-frontmatter]]\n";

describe("the chat's memoryNote pointer", () => {
  test("is absent until set, then reads back; attachedTo is untouched", () => {
    expect(chatMemoryNote(CHAT)).toBeNull();
    const next = setChatMemoryNote(CHAT, "plan-chat-notes");
    expect(chatMemoryNote(next)).toBe("plan-chat-notes");
    expect(next).toContain("attachedTo: [[my-plan]]");
    expect(next.endsWith("memoryNote: [[not-frontmatter]]\n")).toBe(true);
  });

  test("setting it again replaces the one line", () => {
    const twice = setChatMemoryNote(setChatMemoryNote(CHAT, "a"), "b");
    expect(twice.match(/^memoryNote:/gm)?.length).toBe(2); // the frontmatter line + the message text
    expect(chatMemoryNote(twice)).toBe("b");
  });

  test("a file without frontmatter is left alone", () => {
    expect(setChatMemoryNote("## Messages\n", "x")).toBe("## Messages\n");
  });
});
