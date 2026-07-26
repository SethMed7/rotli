// Grouping locks for the Tasks surface: first-seen note order survives, tasks
// keep their in-note order, and duplicate titles never merge across ids.

import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../lib/tauri";
import { groupTasks } from "./tasksView";

const t = (over: Partial<TaskItem>): TaskItem => ({
  noteId: "01A",
  noteTitle: "Plan",
  line: 0,
  text: "call the bank",
  ...over,
});

describe("groupTasks", () => {
  test("groups by note in first-seen order, tasks in projection order", () => {
    const groups = groupTasks([
      t({ line: 2 }),
      t({ noteId: "01B", noteTitle: "Trip", line: 0, text: "book flights" }),
      t({ line: 5, text: "send docs" }),
    ]);
    expect(groups.map((g) => g.noteId)).toEqual(["01A", "01B"]);
    expect(groups[0]?.tasks.map((x) => x.text)).toEqual(["call the bank", "send docs"]);
  });

  test("same title, different ids — two groups, never merged", () => {
    const groups = groupTasks([t({}), t({ noteId: "01C" })]);
    expect(groups).toHaveLength(2);
  });

  test("empty in, empty out", () => {
    expect(groupTasks([])).toEqual([]);
  });
});
