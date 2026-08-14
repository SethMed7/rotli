import { describe, expect, test } from "bun:test";

import { conversationPrompts, promptMenuOffset, promptPreview } from "./chatPromptNavigatorModel";

describe("conversation prompt navigation", () => {
  test("uses only user turns and keeps their real message indexes", () => {
    expect(
      conversationPrompts([
        { speaker: "you", text: "First" },
        { speaker: "rotli", text: "Answer" },
        { speaker: "you", text: "Second" },
      ]),
    ).toEqual([
      { messageIndex: 0, text: "First" },
      { messageIndex: 2, text: "Second" },
    ]);
  });

  test("collapses multiline prompts and caps the menu label", () => {
    expect(promptPreview("  one\n\n two   three  ", 12)).toBe("one two thr…");
  });

  test("an image-only turn still has a useful landmark", () => {
    expect(promptPreview("  ")).toBe("Image prompt");
  });

  test("top-aligns the prompt list with its marker when the list fits", () => {
    expect(
      promptMenuOffset({
        triggerTop: 220,
        menuHeight: 310,
        boundaryTop: 100,
        boundaryBottom: 700,
      }),
    ).toBe(0);
  });

  test("shifts only enough to keep a tall prompt list inside the chat", () => {
    expect(
      promptMenuOffset({
        triggerTop: 360,
        menuHeight: 310,
        boundaryTop: 100,
        boundaryBottom: 620,
      }),
    ).toBe(-62);

    expect(
      promptMenuOffset({
        triggerTop: 180,
        menuHeight: 700,
        boundaryTop: 100,
        boundaryBottom: 620,
      }),
    ).toBe(-68);
  });
});
