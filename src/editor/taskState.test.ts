// The checkbox grammar. These tests are the reason the nine hand-written
// restatements collapsed into one: they pin the marks and the click cycle so a
// tenth site can't quietly disagree.

import { describe, expect, test } from "bun:test";

import {
  markOf,
  nextTaskState,
  ORDERED_TASK_RE,
  TASK_LINE_RE,
  TASK_RE,
  taskStateOf,
  type TaskState,
} from "./taskState";

describe("marks", () => {
  test("the three states round-trip through their marks", () => {
    for (const s of ["open", "doing", "done"] as TaskState[]) {
      expect(taskStateOf(markOf(s))).toBe(s);
    }
  });

  test("a capital X still reads as done", () => {
    expect(taskStateOf("X")).toBe("done");
  });

  test("`/` is in progress — NOT done (it used to render as a checked box)", () => {
    expect(taskStateOf("/")).toBe("doing");
  });
});

describe("the regexes accept all three marks", () => {
  test("plain tasks", () => {
    expect(TASK_RE.exec("- [ ] a")?.[1]).toBe(" ");
    expect(TASK_RE.exec("- [/] a")?.[1]).toBe("/");
    expect(TASK_RE.exec("- [x] a")?.[1]).toBe("x");
  });

  test("ordered tasks keep their number", () => {
    const m = ORDERED_TASK_RE.exec("3. [/] a");
    expect(m?.[1]).toBe("3");
    expect(m?.[2]).toBe("/");
  });

  test("the whole-line form captures the prefix so a rewrite can rebuild it", () => {
    const m = TASK_LINE_RE.exec("    - [/] nested");
    expect(m?.[1]).toBe("    - ");
    expect(m?.[2]).toBe("/");
  });

  test("a bullet that isn't a task never matches", () => {
    expect(TASK_RE.exec("- plain")).toBeNull();
    expect(TASK_LINE_RE.exec("- [z] bogus")).toBeNull();
  });
});

describe("nextTaskState", () => {
  test("two-state: the classic open⇄done, unchanged", () => {
    expect(nextTaskState("open", false)).toBe("done");
    expect(nextTaskState("done", false)).toBe("open");
  });

  test("two-state: a hand-typed [/] still checks off in ONE click", () => {
    expect(nextTaskState("doing", false)).toBe("done");
  });

  test("three-state: click once for in progress, again for complete", () => {
    expect(nextTaskState("open", true)).toBe("doing");
    expect(nextTaskState("doing", true)).toBe("done");
    expect(nextTaskState("done", true)).toBe("open");
  });
});
