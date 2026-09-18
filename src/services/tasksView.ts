// The Tasks view fold (decision 2026-07-25): group the flat projection by note,
// preserving corpus list order (pinned, then recently updated — the order the
// Rust projection already walks). Pure — the surface renders, this decides.

import type { TaskItem } from "../lib/tauri";

export interface TaskGroup {
  noteId: string;
  noteTitle: string;
  tasks: TaskItem[];
  updatedAt: number;
}

export function groupTasks(
  items: TaskItem[],
  updatedAtByNote: ReadonlyMap<string, number> = new Map(),
): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const byNote = new Map<string, TaskGroup>();
  for (const item of items) {
    let group = byNote.get(item.noteId);
    if (!group) {
      group = {
        noteId: item.noteId,
        noteTitle: item.noteTitle,
        tasks: [],
        updatedAt: updatedAtByNote.get(item.noteId) ?? 0,
      };
      byNote.set(item.noteId, group);
      groups.push(group);
    }
    group.tasks.push(item);
  }
  return groups;
}

export function filterTaskGroups(groups: readonly TaskGroup[], query: string): TaskGroup[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...groups];
  // a note whose TITLE matches keeps all its tasks; otherwise only the tasks
  // that match stay, so a search reads as results rather than whole notes
  return groups.flatMap((group) => {
    if (group.noteTitle.toLocaleLowerCase().includes(q)) return [group];
    const tasks = group.tasks.filter((task) => task.text.toLocaleLowerCase().includes(q));
    return tasks.length > 0 ? [{ ...group, tasks }] : [];
  });
}

/** A note untouched this long has its open tasks set aside under Archived
 * (the owner, 2026-09-18). A projection only: nothing moves on disk, and any
 * edit to the note brings its tasks back. */
export const TASK_ARCHIVE_DAYS = 30;

/** Settings → General → Tasks: how long a note rests before its tasks are set
 * aside, or never. A string enum so it persists like every other choice. */
export type TaskArchiveAge = "14" | "30" | "60" | "90" | "never";
export const TASK_ARCHIVE_AGES: readonly TaskArchiveAge[] = ["14", "30", "60", "90", "never"];
export const DEFAULT_TASK_ARCHIVE_AGE: TaskArchiveAge = "30";

/** The cutoff in days; Infinity when nothing is ever archived. */
export function taskArchiveDays(age: TaskArchiveAge): number {
  return age === "never" ? Infinity : Number(age);
}

export interface TaskSection {
  id: "this-week" | "last-week" | "last-30-days" | "archived";
  label: string;
  groups: TaskGroup[];
  /** Archived starts closed and shows a count; the live sections are open. */
  archived: boolean;
}

export function taskCount(groups: readonly TaskGroup[]): number {
  return groups.reduce((sum, group) => sum + group.tasks.length, 0);
}

export function sectionTaskGroups(
  groups: readonly TaskGroup[],
  nowMs: number,
  archiveDays: number = TASK_ARCHIVE_DAYS,
): TaskSection[] {
  const day = 24 * 60 * 60 * 1_000;
  const definitions: Array<Omit<TaskSection, "groups"> & { maxAge: number }> = [
    { id: "this-week", label: "This week", maxAge: Math.min(7, archiveDays) * day, archived: false },
    { id: "last-week", label: "Last week", maxAge: Math.min(14, archiveDays) * day, archived: false },
    { id: "last-30-days", label: "Earlier", maxAge: archiveDays * day, archived: false },
    { id: "archived", label: "Archived", maxAge: Infinity, archived: true },
  ];
  return definitions
    .map(({ maxAge, ...section }, index) => {
      const minAge = index === 0 ? -Infinity : definitions[index - 1]!.maxAge;
      return {
        ...section,
        groups: groups.filter((group) => {
          const age = group.updatedAt > 0 ? Math.max(0, nowMs - group.updatedAt) : Infinity;
          return age >= minAge && age < maxAge;
        }),
      };
    })
    .filter((section) => section.groups.length > 0);
}
