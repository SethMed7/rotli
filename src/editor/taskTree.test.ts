// Parent-task progress. The counter is COMPUTED and never written, so what
// matters is that the number always matches the boxes a person can see sitting
// directly under the parent.

import { describe, expect, test } from "bun:test";

import { type TaskNode, taskProgress } from "./taskTree";

/** Build the task list from an indent sketch: "x" = done, "o" = open. */
function tasks(sketch: string): TaskNode[] {
  const out: TaskNode[] = [];
  sketch
    .trim()
    .split("\n")
    .forEach((raw, line) => {
      const indent = raw.length - raw.trimStart().length;
      const mark = raw.trim()[0];
      if (mark === "x" || mark === "o") out.push({ line, indent, done: mark === "x" });
    });
  return out;
}

describe("taskProgress", () => {
  test("a parent counts its direct children — ZenNotes' 2/4", () => {
    // Ship it (2 of 4 done)
    const p = taskProgress(
      tasks(`
o parent
  x merged
  x tagged
  o pushed
  o posted
`),
    );
    expect(p.get(0)).toEqual({ done: 2, total: 4 });
  });

  test("a childless task gets NO entry — never a 0/0 badge", () => {
    const p = taskProgress(tasks("o alone\nx also alone"));
    expect(p.size).toBe(0);
  });

  test("grandchildren do NOT inflate the parent's count", () => {
    const p = taskProgress(
      tasks(`
o parent
  o child one
    x grandchild
    x grandchild
  x child two
`),
    );
    // the parent has TWO children, not four
    expect(p.get(0)).toEqual({ done: 1, total: 2 });
    // …and the middle child reports its own pair
    expect(p.get(1)).toEqual({ done: 2, total: 2 });
  });

  test("a sibling at the same indent ends the parent's run", () => {
    const p = taskProgress(
      tasks(`
o first
  x its child
o second
  o child a
  o child b
`),
    );
    expect(p.get(0)).toEqual({ done: 1, total: 1 });
    expect(p.get(2)).toEqual({ done: 0, total: 2 });
  });

  test("a done parent still reports its children", () => {
    const p = taskProgress(tasks("x done parent\n  x a\n  o b"));
    expect(p.get(0)).toEqual({ done: 1, total: 2 });
  });

  test("all children done reads as total/total", () => {
    const p = taskProgress(tasks("o parent\n  x a\n  x b"));
    expect(p.get(0)).toEqual({ done: 2, total: 2 });
  });

  test("ragged indentation still picks the shallowest level as the children", () => {
    // a 3-space child and a 2-space child are BOTH children of the parent, but
    // the shallowest depth defines the child level — the deeper one is its own
    const p = taskProgress(
      tasks(`
o parent
  o even
   o deeper
  x even too
`),
    );
    expect(p.get(0)).toEqual({ done: 1, total: 2 });
  });

  test("an empty document yields nothing", () => {
    expect(taskProgress([]).size).toBe(0);
  });

  test("line numbers are preserved, so the widget lands on the right row", () => {
    const p = taskProgress([
      { line: 7, indent: 0, done: false },
      { line: 9, indent: 2, done: true },
    ]);
    expect([...p.keys()]).toEqual([7]);
  });
});
