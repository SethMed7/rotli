import { describe, expect, test } from "bun:test";

import { splitImageRefs } from "./chatImageRefs";

describe("splitImageRefs", () => {
  test("a message with no attachments is one text run", () => {
    expect(splitImageRefs("just words")).toEqual([{ kind: "text", value: "just words" }]);
  });

  test("references become chips in order; the prose around them keeps its whitespace", () => {
    expect(splitImageRefs("[Image #1] [Image #2]\nwhat is this?")).toEqual([
      { kind: "ref", index: 1 },
      { kind: "text", value: " " },
      { kind: "ref", index: 2 },
      { kind: "text", value: "\nwhat is this?" },
    ]);
  });

  test("a reference inside the prose stays where the user put it", () => {
    expect(splitImageRefs("compare [Image #3] with the mock")).toEqual([
      { kind: "text", value: "compare " },
      { kind: "ref", index: 3 },
      { kind: "text", value: " with the mock" },
    ]);
  });

  test("a bracketed word that is not an image reference is left alone", () => {
    expect(splitImageRefs("[Image] [image #x] [Note #1]")).toEqual([
      { kind: "text", value: "[Image] [image #x] [Note #1]" },
    ]);
  });
});
