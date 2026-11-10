import { expect, test } from "bun:test";

import { afterFrontmatter, frontmatterBlock, protectionMark, withFrontmatterBlock } from "./frontmatterBlock";

test("reads the first block with either line ending, and writes it back in the file's own", () => {
  for (const nl of ["\n", "\r\n"] as const) {
    const file = `---${nl}title: Harbor${nl}tags: [a]${nl}---${nl}${nl}body${nl}`;
    const block = frontmatterBlock(file)!;
    expect(block.inner).toBe("title: Harbor\ntags: [a]");
    expect(block.newline).toBe(nl);
    expect(withFrontmatterBlock(file, block, `${block.inner}\npinned: true`)).toBe(
      `---${nl}title: Harbor${nl}tags: [a]${nl}pinned: true${nl}---${nl}${nl}body${nl}`,
    );
    expect(afterFrontmatter(file)).toBe(`${nl}body${nl}`);
  }
});

test("a byte-order mark is kept, and a file without a block is left alone", () => {
  const file = "﻿---\ntitle: A\n---\nbody";
  const block = frontmatterBlock(file)!;
  expect(withFrontmatterBlock(file, block, "title: B")).toBe("﻿---\ntitle: B\n---\nbody");
  expect(frontmatterBlock("# just a note\n---\nnot frontmatter")).toBeNull();
  expect(afterFrontmatter("plain")).toBe("plain");
});

test("a protection mark: set, unset, and unreadable counts as set", () => {
  expect(protectionMark("---\r\nsecureContext: true\r\n---\r\n", "secureContext")).toBe(true);
  expect(protectionMark("---\nsecureContext: false\n---\n", "secureContext")).toBe(false);
  expect(protectionMark("---\ntitle: x\n", "secureContext")).toBe(true); // a fence that never closes
  expect(protectionMark("no block\nsecureContext: true\n", "secureContext")).toBe(false); // body text never counts
});
