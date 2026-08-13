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
  return groups.filter(
    (group) =>
      group.noteTitle.toLocaleLowerCase().includes(q) ||
      group.tasks.some((task) => task.text.toLocaleLowerCase().includes(q)),
  );
}

export interface TaskSection {
  id: "this-week" | "last-week" | "last-30-days" | "older";
  label: string;
  groups: TaskGroup[];
}

export function sectionTaskGroups(groups: readonly TaskGroup[], nowMs: number): TaskSection[] {
  const day = 24 * 60 * 60 * 1_000;
  const definitions: Array<Omit<TaskSection, "groups"> & { maxAge: number }> = [
    { id: "this-week", label: "This week", maxAge: 7 * day },
    { id: "last-week", label: "Last week", maxAge: 14 * day },
    { id: "last-30-days", label: "Last 30 days", maxAge: 30 * day },
    { id: "older", label: "30+ days ago", maxAge: Infinity },
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
