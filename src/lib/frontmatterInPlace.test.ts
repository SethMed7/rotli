// The in-place composer (frontmatterInPlace.ts, twin of corpus_in_place.rs)
// edits a key a person spelled with a space, as Obsidian's `date created`,
// in place and once. Synthetic frontmatter only.
import { expect, test } from "bun:test";

import { parseNoteDocument } from "./frontmatter";
import { composeInPlace, withTopLevelLine } from "./frontmatterInPlace";

const NOTE = "---\ndate created: 2020-01-01\ntags: [plan]\n---\n# Plan\n";

test("a key with a space in it is edited and removed in place, never repeated", () => {
  const before = parseNoteDocument(NOTE).frontmatter!;
  const edited = { ...before, foreign: ["date created: 2021-02-02", "tags: [plan]"] };
  expect(composeInPlace(NOTE, edited)).toBe("---\ndate created: 2021-02-02\ntags: [plan]\n---\n# Plan\n");
  const removed = { ...before, foreign: ["tags: [plan]"] };
  expect(composeInPlace(NOTE, removed)).toBe("---\ntags: [plan]\n---\n# Plan\n");
});

// Codex review of pull request 303, blocker 1: the composer wrote Rotli's own
// `ai_edit: true` from a typed `"ai_edit": true`; it copies the action's line.
test("an action's typed line is copied verbatim, never canonicalised", () => {
  const original = "---\ncreated_by: person\n---\nWords.\n";
  const next = {
    ...parseNoteDocument(original).frontmatter!,
    foreign: ["created_by: person", '"ai_edit": true'],
  };
  expect(composeInPlace(original, next)).toBe('---\ncreated_by: person\n"ai_edit": true\n---\nWords.\n');
});

// Codex review of pull request 303, item 8
test("a key with a space before its colon is replaced, not repeated", () => {
  expect(withTopLevelLine("---\ndate created : 2020\n---\nWords.\n", "date created", "2021")).toBe(
    "---\ndate created: 2021\n---\nWords.\n",
  );
});
