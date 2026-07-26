// The Tasks view fold (decision 2026-07-25): group the flat projection by note,
// preserving corpus list order (pinned, then recently updated — the order the
// Rust projection already walks). Pure — the surface renders, this decides.

import type { TaskItem } from "../lib/tauri";

export interface TaskGroup {
  noteId: string;
  noteTitle: string;
  tasks: TaskItem[];
}

export function groupTasks(items: TaskItem[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const byNote = new Map<string, TaskGroup>();
  for (const item of items) {
    let group = byNote.get(item.noteId);
    if (!group) {
      group = { noteId: item.noteId, noteTitle: item.noteTitle, tasks: [] };
      byNote.set(item.noteId, group);
      groups.push(group);
    }
    group.tasks.push(item);
  }
  return groups;
}
