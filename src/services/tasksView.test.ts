// Grouping locks for the Tasks surface: first-seen note order survives, tasks
// keep their in-note order, and duplicate titles never merge across ids.

import { describe, expect, test } from "bun:test";

import type { TaskItem } from "../lib/tauri";
import {
  TASK_ARCHIVE_AGES,
  filterTaskGroups,
  groupTasks,
  sectionTaskGroups,
  taskArchiveDays,
  taskCount,
} from "./tasksView";

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

  test("groups owning notes by useful age buckets without changing task order", () => {
    const day = 86_400_000;
    const now = Date.UTC(2026, 7, 12);
    const groups = groupTasks(
      [
        t({ noteId: "this", noteTitle: "Today" }),
        t({ noteId: "last", noteTitle: "Last week" }),
        t({ noteId: "month", noteTitle: "This month" }),
        t({ noteId: "old", noteTitle: "Old" }),
      ],
      new Map([
        ["this", now - day],
        ["last", now - 8 * day],
        ["month", now - 20 * day],
        ["old", now - 40 * day],
      ]),
    );

    expect(
      sectionTaskGroups(groups, now).map((section) => [section.label, section.groups[0]?.noteId]),
    ).toEqual([
      ["This week", "this"],
      ["Last week", "last"],
      ["Earlier", "month"],
      ["Archived", "old"],
    ]);
    // only the last is archived: it starts closed and carries a count
    expect(sectionTaskGroups(groups, now).map((section) => section.archived)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  test("the archive cutoff is a setting: shorter archives sooner, never archives nothing", () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = Date.UTC(2026, 8, 18);
    const groups = groupTasks(
      [t({ noteId: "recent", noteTitle: "Recent" }), t({ noteId: "stale", noteTitle: "Stale" })],
      new Map([
        ["recent", now - 3 * day],
        ["stale", now - 20 * day],
      ]),
    );
    const archivedIds = (days: number) =>
      sectionTaskGroups(groups, now, days)
        .filter((section) => section.archived)
        .flatMap((section) => section.groups.map((group) => group.noteId));
    expect(archivedIds(taskArchiveDays("14"))).toEqual(["stale"]);
    expect(archivedIds(taskArchiveDays("30"))).toEqual([]);
    expect(archivedIds(taskArchiveDays("never"))).toEqual([]);
    // every group lands in exactly one section, whatever the cutoff
    for (const age of TASK_ARCHIVE_AGES) {
      const placed = sectionTaskGroups(groups, now, taskArchiveDays(age)).flatMap((s) => s.groups);
      expect(placed).toHaveLength(2);
    }
  });

  test("a task-text match keeps only the matching tasks; a title match keeps the note whole", () => {
    const groups = groupTasks([
      t({ noteId: "plan", noteTitle: "Launch plan", text: "Call the bank", line: 1 }),
      t({ noteId: "plan", noteTitle: "Launch plan", text: "Order cake", line: 2 }),
    ]);
    expect(filterTaskGroups(groups, "cake")[0]?.tasks.map((task) => task.text)).toEqual(["Order cake"]);
    expect(filterTaskGroups(groups, "launch")[0]?.tasks).toHaveLength(2);
    expect(taskCount(filterTaskGroups(groups, "launch"))).toBe(2);
  });

  test("searches note titles and task text", () => {
    const groups = groupTasks([
      t({ noteId: "plan", noteTitle: "Launch plan", text: "Call the bank" }),
      t({ noteId: "trip", noteTitle: "Travel", text: "Book flights" }),
    ]);
    expect(filterTaskGroups(groups, "launch").map((group) => group.noteId)).toEqual(["plan"]);
    expect(filterTaskGroups(groups, "flights").map((group) => group.noteId)).toEqual(["trip"]);
  });
});
