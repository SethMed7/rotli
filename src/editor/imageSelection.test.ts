import { describe, expect, test } from "bun:test";

import { selectionCoversImage } from "./imageSelection";

describe("selectionCoversImage", () => {
  test("exact and larger selections keep the image selected", () => {
    expect(selectionCoversImage({ from: 10, to: 30 }, 10, 30)).toBe(true);
    expect(selectionCoversImage({ from: 0, to: 80 }, 10, 30)).toBe(true);
  });

  test("a caret or partial selection reveals editable image Markdown", () => {
    expect(selectionCoversImage({ from: 15, to: 15 }, 10, 30)).toBe(false);
    expect(selectionCoversImage({ from: 15, to: 30 }, 10, 30)).toBe(false);
    expect(selectionCoversImage({ from: 10, to: 25 }, 10, 30)).toBe(false);
  });
});
