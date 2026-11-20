// The in-place composer (frontmatterInPlace.ts, twin of corpus_in_place.rs)
// edits a key a person spelled with a space, as Obsidian's `date created`,
// in place and once. Synthetic frontmatter only.
import { expect, test } from "bun:test";

import { parseNoteDocument } from "./frontmatter";
import { composeInPlace } from "./frontmatterInPlace";

const NOTE = "---\ndate created: 2020-01-01\ntags: [plan]\n---\n# Plan\n";

test("a key with a space in it is edited and removed in place, never repeated", () => {
  const before = parseNoteDocument(NOTE).frontmatter!;
  const edited = { ...before, foreign: ["date created: 2021-02-02", "tags: [plan]"] };
  expect(composeInPlace(NOTE, edited)).toBe("---\ndate created: 2021-02-02\ntags: [plan]\n---\n# Plan\n");
  const removed = { ...before, foreign: ["tags: [plan]"] };
  expect(composeInPlace(NOTE, removed)).toBe("---\ntags: [plan]\n---\n# Plan\n");
});
