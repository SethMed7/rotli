// The fold RANGE math — the part that decides what a section owns. Kept pure so
// the nesting rules are provable without a view: a fold must take its
// sub-sections with it, must never swallow the next sibling, and must never
// treat a `#` inside a code fence as a heading.

import { describe, expect, test } from "bun:test";

import { foldLines, headingFoldRange } from "./foldRanges";

/** Build the line model the way the editor does, from a plain document. */
function model(doc: string) {
  const texts = doc.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const t of texts) {
    offsets.push(at);
    at += t.length + 1;
  }
  return { lines: foldLines(texts, offsets), texts, offsets };
}

/** The text a fold would hide, for readable assertions. */
function hidden(doc: string, index: number): string | null {
  const { lines } = model(doc);
  const range = headingFoldRange(lines, index);
  return range ? doc.slice(range.from, range.to) : null;
}

describe("foldLines — what counts as a heading", () => {
  test("levels 1 through 6 are all headings", () => {
    const { lines } = model("# a\n## b\n### c\n#### d\n##### e\n###### f");
    expect(lines.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("seven hashes, a bare hash, and a hash with no text are not headings", () => {
    const { lines } = model("####### x\n#\n#no-space");
    expect(lines.map((l) => l.level)).toEqual([0, 0, 0]);
  });

  test("a # inside a fence is CODE, never a heading", () => {
    const { lines } = model("# real\n```sh\n# a shell comment\n```\n# also real");
    expect(lines.map((l) => l.level)).toEqual([1, 0, 0, 0, 1]);
  });
});

describe("headingFoldRange — what a section owns", () => {
  const doc = ["# Top", "intro", "## One", "body one", "### Deep", "deep body", "## Two", "body two"].join(
    "\n",
  );

  test("a heading hides its body but stays visible itself", () => {
    const text = hidden(doc, 2); // ## One
    expect(text).toContain("body one");
    expect(text).not.toContain("## One"); // the heading line is never hidden
  });

  test("folding a section takes its DEEPER subsections with it", () => {
    const text = hidden(doc, 2)!; // ## One
    expect(text).toContain("### Deep");
    expect(text).toContain("deep body");
  });

  test("…and stops before the next SIBLING", () => {
    const text = hidden(doc, 2)!;
    expect(text).not.toContain("## Two");
    expect(text).not.toContain("body two");
  });

  test("the top heading owns the whole document below it", () => {
    const text = hidden(doc, 0)!;
    expect(text).toContain("## One");
    expect(text).toContain("## Two");
    expect(text).toContain("body two");
  });

  test("the LAST section runs to the end of the document", () => {
    const text = hidden(doc, 6)!; // ## Two
    expect(text.trim()).toBe("body two");
  });

  test("a non-heading line folds nothing", () => {
    expect(hidden(doc, 1)).toBeNull();
  });

  test("a heading with an empty section folds nothing — no phantom affordance", () => {
    expect(hidden("# a\n# b", 0)).toBeNull();
    expect(hidden("## x", 0)).toBeNull();
  });

  test("a deeper heading does NOT end a shallower one (H3 then H2)", () => {
    const d = "### deep first\nbody\n## shallower";
    const text = hidden(d, 0)!;
    expect(text).toContain("body");
    expect(text).not.toContain("## shallower");
  });

  test("code inside a section is folded away with it, fence and all", () => {
    const d = "## Setup\n```sh\nnpm i\n```\ndone\n## Next";
    const text = hidden(d, 0)!;
    expect(text).toContain("npm i");
    expect(text).not.toContain("## Next");
  });

  test("ranges never overlap a sibling's range", () => {
    const { lines } = model(doc);
    const one = headingFoldRange(lines, 2)!;
    const two = headingFoldRange(lines, 6)!;
    expect(one.to).toBeLessThanOrEqual(two.from);
  });
});
