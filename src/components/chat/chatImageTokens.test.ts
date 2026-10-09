import { describe, expect, test } from "bun:test";

import { composeImageText, insertImageTags, removeImageTag } from "./chatImageTokens";

describe("insertImageTags — attaching types a tag at the caret", () => {
  test("into an empty message", () => {
    expect(insertImageTags("", 0, 1, 1)).toEqual({ text: "[Image #1]", caret: 10 });
  });

  test("between words, spaced from both", () => {
    expect(insertImageTags("see this here", 8, 2, 1)).toEqual({
      text: "see this [Image #2] here",
      caret: 19,
    });
    expect(insertImageTags("see this", 8, 1, 1).text).toBe("see this [Image #1]");
  });

  test("several images at once, numbered on", () => {
    expect(insertImageTags("look ", 5, 2, 2).text).toBe("look [Image #2] [Image #3]");
  });

  test("a caret past the end clamps to the end", () => {
    expect(insertImageTags("hi", 99, 1, 1).text).toBe("hi [Image #1]");
  });
});

describe("removeImageTag — removing a thumbnail removes its tag", () => {
  test("and renumbers the later tags", () => {
    expect(removeImageTag("[Image #1] and [Image #2] then [Image #3]", 2)).toBe(
      "[Image #1] and then [Image #2]",
    );
  });

  test("at the start, without leaving a leading space", () => {
    expect(removeImageTag("[Image #1] look at [Image #2]", 1)).toBe("look at [Image #1]");
  });

  test("leaves a text without tags alone", () => {
    expect(removeImageTag("no tags here", 1)).toBe("no tags here");
  });
});

describe("composeImageText — the message as sent", () => {
  const images = [{ id: "storage/images/a.png" }, { id: "storage/images/b.png" }];

  test("a tag becomes its durable link where it was typed", () => {
    expect(composeImageText("compare [Image #2] with [Image #1]", images)).toBe(
      "compare [Image #2](storage:images/b.png) with [Image #1](storage:images/a.png)",
    );
  });

  test("an untagged image leads the message, as before", () => {
    expect(composeImageText("about [Image #2]", images)).toBe(
      "[Image #1](storage:images/a.png)\nabout [Image #2](storage:images/b.png)",
    );
    expect(composeImageText("", images)).toBe(
      "[Image #1](storage:images/a.png) [Image #2](storage:images/b.png)",
    );
  });

  test("a tag with no image stays text, and no images changes nothing", () => {
    expect(composeImageText("[Image #7] stays", images.slice(0, 1))).toBe(
      "[Image #1](storage:images/a.png)\n[Image #7] stays",
    );
    expect(composeImageText("plain [Image #1]", [])).toBe("plain [Image #1]");
  });

  test("an image that has no vault id keeps a bare tag", () => {
    expect(composeImageText("x [Image #1]", [{ id: "" }])).toBe("x [Image #1]");
  });
});
