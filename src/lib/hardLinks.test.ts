import { describe, expect, test } from "bun:test";

import { hardLinked, isHardLinkRefusal, searchSkippedLine, skippedSummary } from "./hardLinks";

describe("what Rotli says about hard-linked files", () => {
  test("one sentence, in the singular and the plural", () => {
    expect(skippedSummary(1)).toBe(
      "1 file wasn’t opened because it has a hard link. Your file is still on disk.",
    );
    expect(skippedSummary(3)).toBe(
      "3 files weren’t opened because they have hard links. Your files are still on disk.",
    );
    expect(searchSkippedLine(1)).toBe("1 file wasn’t searched because it has a hard link.");
  });

  test("Rust's refusal is recognised by its words, and nothing else is", () => {
    expect(isHardLinkRefusal("read a.md: this file has a hard link, so Rotli doesn't open it")).toBe(true);
    expect(isHardLinkRefusal(new Error("read a.md: not a plain file (a special file or a folder)"))).toBe(
      false,
    );
    expect(isHardLinkRefusal(undefined)).toBe(false);
  });

  test("only hard-link reasons are counted", () => {
    expect(hardLinked(undefined)).toEqual([]);
    expect(hardLinked([{ path: "a.md", reason: "hardLink" }])).toEqual([
      { path: "a.md", reason: "hardLink" },
    ]);
  });
});
