import { describe, expect, test } from "bun:test";

import { imageSourceSpan, selectionCoversImage } from "./imageSelection";

describe("imageSourceSpan", () => {
  test("finds standalone and list image source spans", () => {
    expect(imageSourceSpan("![](storage:photo.png)", 10)).toEqual({
      from: 10,
      to: 32,
      alt: "",
      src: "storage:photo.png",
    });
    expect(imageSourceSpan("- ![caption](storage:list.png)", 20)).toEqual({
      from: 22,
      to: 50,
      alt: "caption",
      src: "storage:list.png",
    });
    expect(imageSourceSpan("3. [/] ![](storage:task.png)", 5)).toEqual({
      from: 12,
      to: 33,
      alt: "",
      src: "storage:task.png",
    });
  });

  test("does not treat inline images or image-like prose as image widgets", () => {
    expect(imageSourceSpan("Before ![](storage:inline.png)", 0)).toBeNull();
    expect(imageSourceSpan("> ![](storage:quote.png)", 0)).toBeNull();
  });
});

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
