import { describe, expect, test } from "bun:test";

import { checkOff, joinedTaskText, openTaskText, openTasksInBody } from "./taskLines";

describe("open-task grammar — the twin of corpus.rs", () => {
  test("bulleted, starred, ordered, and in-progress boxes are open; checked and empty ones are not", () => {
    expect(openTaskText("- [ ] call the bank")).toBe("call the bank");
    expect(openTaskText("* [ ] star")).toBe("star");
    expect(openTaskText("12. [ ] ordered")).toBe("ordered");
    expect(openTaskText("- [/] halfway")).toBe("halfway");
    expect(openTaskText("- [x] done")).toBeNull();
    expect(openTaskText("- [ ]")).toBeNull();
    expect(openTaskText("- [ ]   ")).toBeNull();
    expect(openTaskText("- [ ]nospace")).toBeNull();
    expect(openTaskText("plain text")).toBeNull();
  });

  test("a hard-wrapped task joins its indented continuations, and stops at the next block", () => {
    const lines = ["- [ ] set the flag on the", "  second line", "  - [ ] a nested task", "after"];
    expect(joinedTaskText(lines, 0)).toBe("set the flag on the second line");
    expect(joinedTaskText(lines, 2)).toBe("a nested task");
    expect(joinedTaskText(lines, 3)).toBeNull();
  });

  test("fenced code is skipped, and lines index the body", () => {
    const body = ["# Plan", "- [ ] one", "```", "- [ ] not a task", "```", "  2. [/] two"].join("\n");
    expect(openTasksInBody(body)).toEqual([
      { line: 1, text: "one" },
      { line: 5, text: "two" },
    ]);
  });

  test("checking off flips the box by position and leaves the words alone", () => {
    expect(checkOff("- [/] fix the [ ] case")).toBe("- [x] fix the [ ] case");
    expect(checkOff("    3. [ ] indented ordered")).toBe("    3. [x] indented ordered");
    expect(checkOff("- [x] already")).toBeNull();
    expect(checkOff("no task here [ ]")).toBeNull();
  });
});
