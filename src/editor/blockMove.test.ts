import { describe, expect, test } from "bun:test";

import { type BlockMoveTarget, blockSpans, planBlockMove } from "./blockMove";

const NOTE = "# Moves\n\nFirst paragraph.\n\n- item one\n- item two\n\nSecond paragraph.\n\nlast line\n";

/** Apply a plan the way CodeMirror applies one change. `target` is the text
 * of the block to land before, or "end". */
function moved(doc: string, source: string, target: string): string {
  const sourceFrom = doc.indexOf(source);
  const resolved: BlockMoveTarget = target === "end" ? "end" : { before: doc.indexOf(target) };
  const plan = planBlockMove(doc, sourceFrom, resolved);
  if (!plan) return doc;
  const next = doc.slice(0, plan.from) + plan.insert + doc.slice(plan.to);
  expect(next.slice(plan.movedAt).startsWith(source)).toBe(true);
  return next;
}

describe("block spans", () => {
  test("a block is a run of non-blank lines; blank and whitespace lines separate", () => {
    expect(blockSpans("a\nb\n\n  \nc").map((s) => [s.from, s.to])).toEqual([
      [0, 3],
      [8, 9],
    ]);
  });
});

describe("moving a block", () => {
  test("down, before a later block: lands whole, never inside the text it passes", () => {
    expect(moved(NOTE, "First paragraph.", "Second paragraph.")).toBe(
      "# Moves\n\n- item one\n- item two\n\nFirst paragraph.\n\nSecond paragraph.\n\nlast line\n",
    );
  });

  test("to the end of the note: after the last block, one blank line between", () => {
    expect(moved(NOTE, "First paragraph.", "end")).toBe(
      "# Moves\n\n- item one\n- item two\n\nSecond paragraph.\n\nlast line\n\nFirst paragraph.\n",
    );
  });

  test("the last block moved up takes its gap with it: no blank lines pile up", () => {
    expect(moved(NOTE, "last line", "First paragraph.")).toBe(
      "# Moves\n\nlast line\n\nFirst paragraph.\n\n- item one\n- item two\n\nSecond paragraph.\n",
    );
  });

  test("a whole list moves with its Markdown intact", () => {
    expect(moved(NOTE, "- item one", "# Moves")).toBe(
      "- item one\n- item two\n\n# Moves\n\nFirst paragraph.\n\nSecond paragraph.\n\nlast line\n",
    );
  });

  test("moving there and back is the original note", () => {
    const there = moved(NOTE, "Second paragraph.", "First paragraph.");
    expect(moved(there, "Second paragraph.", "last line")).toBe(NOTE);
  });

  test("a drop where the block already is changes nothing", () => {
    const from = NOTE.indexOf("First paragraph.");
    expect(planBlockMove(NOTE, from, { before: from })).toBeNull();
    expect(planBlockMove(NOTE, from, { before: NOTE.indexOf("- item one") })).toBeNull();
    expect(planBlockMove(NOTE, NOTE.indexOf("last line"), "end")).toBeNull();
    expect(planBlockMove(NOTE, from + 1, "end")).toBeNull(); // not a block start
    expect(planBlockMove(NOTE, from, { before: NOTE.indexOf("item two") })).toBeNull(); // mid-block
  });

  test("a note without a trailing newline, and wider gaps, stay as they were elsewhere", () => {
    const doc = "one\n\n\n\ntwo\n\nthree";
    expect(moved(doc, "three", "one")).toBe("three\n\none\n\n\n\ntwo");
    expect(moved(doc, "one", "end")).toBe("two\n\nthree\n\none");
  });
});
