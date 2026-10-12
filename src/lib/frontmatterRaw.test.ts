import { expect, test } from "bun:test";

import { RAW_IMMUTABLE_KEYS, mergeRawFrontmatter, rawFrontmatterBlock } from "./frontmatterRaw";

test("raw metadata retains exact block layout and body including CRLF", () => {
  const note =
    "---\r\nid:  stable\r\ncreated: 2026-02-02\r\ncustom:\r\n  id: nested\r\n---\r\n\r\n# Body\r\n";
  expect(rawFrontmatterBlock(note)).toBe(note.slice(0, note.indexOf("\r\n# Body")));
  const merged = mergeRawFrontmatter(
    note,
    "---\nid:  stable\ncreated: 2026-02-02\ncustom:\n  id: changed nested\n\n---\n",
  );
  expect(merged).toContain("  id: changed nested\n\n---\n\r\n# Body\r\n");
});

test("reserved edits, removal, duplicates and invented provenance refuse visibly", () => {
  for (const key of RAW_IMMUTABLE_KEYS) {
    const note = `---\n${key}: untouched\nforeign: old\n---\n# Raw\n`;
    for (const block of [`${key}: changed`, "foreign: changed", `${key}: untouched\n${key}: duplicate`])
      expect(() => mergeRawFrontmatter(note, block)).toThrow(/managed/);
    expect(() => mergeRawFrontmatter("# No provenance\n", `${key}: invented`)).toThrow(/managed/);
  }
});

test("bare fences refuse; fenceless notes accept ordinary metadata without body loss", () => {
  expect(() => mergeRawFrontmatter("# Plain\n", "a: b\n---\nc: d")).toThrow(/bare ---/);
  expect(mergeRawFrontmatter("# Plain\n", "labels: [one]\n")).toBe("---\nlabels: [one]\n---\n# Plain\n");
});
