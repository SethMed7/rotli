import { describe, expect, test } from "bun:test";

import {
  visiblePromptIndexes,
  conversationPrompts,
  promptMenuOffset,
  promptNavigatorTransition,
  promptPreview,
  promptStateClassName,
} from "./chatPromptNavigatorModel";

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

  test("hovering markers previews each matching prompt without replacing the active prompt", () => {
    const firstPreview = promptNavigatorTransition(
      { open: false, previewMessageIndex: null },
      { type: "preview", messageIndex: 2 },
    );
    const nextPreview = promptNavigatorTransition(firstPreview, {
      type: "preview",
      messageIndex: 6,
    });

    expect(firstPreview).toEqual({ open: true, previewMessageIndex: 2 });
    expect(nextPreview).toEqual({ open: true, previewMessageIndex: 6 });
    expect(promptStateClassName(4, [4], nextPreview.previewMessageIndex)).toBe("active");
    expect(promptStateClassName(6, [4], nextPreview.previewMessageIndex)).toBe("preview");
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

describe("visible prompt tracking", () => {
  // The trail tracks the user's prompts, never the responses: a paw lights
  // only while its prompt bubble is on screen.
  const bubbles = [
    { messageIndex: 0, top: -900, bottom: -840 },
    { messageIndex: 4, top: -200, bottom: -140 },
    { messageIndex: 8, top: 300, bottom: 360 },
  ];

  test("only the bubble on screen lights, even while the previous answer's tail is visible", () => {
    expect(visiblePromptIndexes(bubbles, 0, 800)).toEqual([8]);
  });

  test("two bubbles sharing the screen light both paws", () => {
    expect(visiblePromptIndexes(bubbles, -260, 800)).toEqual([4, 8]);
  });

  test("reading a long answer with no bubble on screen lights nothing — the trail tracks prompts, not responses", () => {
    // viewport sits between prompt 4's bubble and prompt 8's
    expect(visiblePromptIndexes(bubbles, -100, 250)).toEqual([]);
    expect(visiblePromptIndexes(bubbles, -1200, -1000)).toEqual([]);
  });

  test("a hairline sliver of a bubble does not flicker its paw on", () => {
    // bubble 8 pokes 6px into a viewport ending at 306
    expect(visiblePromptIndexes(bubbles, -100, 306)).toEqual([]);
  });

  test("unrendered prompts are skipped without lighting anything", () => {
    expect(visiblePromptIndexes([{ messageIndex: 2, top: null, bottom: null }], 0, 600)).toEqual([]);
  });
});

describe("prompt state classes", () => {
  test("every visible prompt is active; preview stacks on top", () => {
    expect(promptStateClassName(4, [4, 8], null)).toBe("active");
    expect(promptStateClassName(8, [4, 8], 8)).toBe("active preview");
    expect(promptStateClassName(0, [4, 8], null)).toBeUndefined();
  });
});
