import { describe, expect, test } from "bun:test";

import { type MovePlan, planLineMove, snapOutOfBlocks } from "./imgMove";

/** Apply a plan's original-coordinate changes the way CM6 does (simultaneous):
 * for non-overlapping changes, applying in descending `from` order is identical. */
function apply(doc: string, plan: MovePlan): string {
  const sorted = [...plan.changes].sort((a, b) => b.from - a.from);
  let out = doc;
  for (const c of sorted) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to ?? c.from);
  }
  return out;
}

describe("planLineMove", () => {
  // the bug this module exists to kill: a downward drag must land AT the drop
  // line, not one image-line above it (changes address the ORIGINAL doc)
  test("downward drag lands before the drop line", () => {
    const doc = "img\nbbb\nccc";
    const plan = planLineMove({ from: 0, to: 3 }, 8, doc.length, "img");
    expect(plan).not.toBeNull();
    expect(apply(doc, plan as MovePlan)).toBe("bbb\nimg\nccc");
    // post-change: "bbb\n" then the moved line
    expect((plan as MovePlan).insertedAt).toBe(4);
  });

  test("upward drag lands before the drop line", () => {
    const doc = "aaa\nbbb\nimg";
    const plan = planLineMove({ from: 8, to: 11 }, 0, doc.length, "img");
    expect(plan).not.toBeNull();
    expect(apply(doc, plan as MovePlan)).toBe("img\naaa\nbbb\n");
    expect((plan as MovePlan).insertedAt).toBe(0);
  });

  test("drop to document end", () => {
    const doc = "img\nbbb\nccc";
    const plan = planLineMove({ from: 0, to: 3 }, "end", doc.length, "img");
    expect(plan).not.toBeNull();
    expect(apply(doc, plan as MovePlan)).toBe("bbb\nccc\nimg");
    expect((plan as MovePlan).insertedAt).toBe(8);
  });

  test("no-ops return null", () => {
    const doc = "img\nbbb";
    const span = { from: 0, to: 3 };
    // onto its own line start
    expect(planLineMove(span, 0, doc.length, "img")).toBeNull();
    // onto the very next line start (insert-before-next == stay put)
    expect(planLineMove(span, 4, doc.length, "img")).toBeNull();
    // last line dropped to end
    expect(planLineMove({ from: 4, to: 7 }, "end", doc.length, "bbb")).toBeNull();
  });

  test("bulleted image line moves with its bullet prefix", () => {
    const doc = "aaa\n- ![x](y)\nccc";
    const plan = planLineMove({ from: 4, to: 13 }, 0, doc.length, "- ![x](y)");
    expect(apply(doc, plan as MovePlan)).toBe("- ![x](y)\naaa\nccc");
  });
});

describe("snapOutOfBlocks", () => {
  const blocks = [{ from: 10, to: 30 }];

  test("outside a block passes through", () => {
    expect(snapOutOfBlocks(10, blocks, 40)).toBe(10); // "before block" is fine
    expect(snapOutOfBlocks(31, blocks, 40)).toBe(31);
    expect(snapOutOfBlocks(0, blocks, 40)).toBe(0);
  });

  test("inside a block snaps to the nearest edge", () => {
    expect(snapOutOfBlocks(14, blocks, 40)).toBe(10); // nearer the start
    expect(snapOutOfBlocks(28, blocks, 40)).toBe(31); // nearer the end
  });

  test("snapping past a block ending at doc end becomes 'end'", () => {
    expect(snapOutOfBlocks(28, [{ from: 10, to: 30 }], 30)).toBe("end");
  });
});
