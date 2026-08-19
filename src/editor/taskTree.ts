// Parent-task progress — the "2/4" a parent shows for its subtasks (the maintainer,
// 2026-08-04, from ZenNotes: "it shows the little 2/4 but it isn't written").
//
// THE RULE THAT MATTERS: this is COMPUTED, never written to the file. The
// markdown stays exactly what you typed; the count is a rendering of what is
// already true, like the checkbox glyph itself. Nothing here edits anything.
//
// Nesting is derived from the indent the editor already tracks (2 columns per
// level, tab-tolerant) — rotli has never built a task tree before, so this is
// the one place the parent→child relation is defined.
//
// Pure: no CodeMirror, no DOM.

/** One task line, reduced to what the count needs. */
export interface TaskNode {
  /** Line index in the document. */
  line: number;
  /** Indent columns (parseBlock's `indent`). */
  indent: number;
  done: boolean;
}

export interface TaskProgress {
  done: number;
  total: number;
}

/**
 * Progress per PARENT line, counting DIRECT children only.
 *
 * "Direct children" = the tasks nested under this one at the shallowest depth
 * found beneath it, so a parent with grandchildren still reports its own
 * children (4 subtasks, not 4 + their 6 sub-subtasks). Counting descendants
 * instead would make a parent's number drift away from the boxes sitting
 * directly under it, which is the thing the user is actually looking at.
 *
 * A task with no children gets NO entry — a childless task must never render
 * "0/0".
 */
export function taskProgress(tasks: readonly TaskNode[]): Map<number, TaskProgress> {
  const out = new Map<number, TaskProgress>();
  for (let i = 0; i < tasks.length; i++) {
    const parent = tasks[i]!;
    // the run of tasks nested under this one ends at the first task at the
    // same or shallower indent
    let end = i + 1;
    while (end < tasks.length && tasks[end]!.indent > parent.indent) end++;
    if (end === i + 1) continue; // no children at all

    // among the descendants, the shallowest depth IS the child level
    let childIndent = Infinity;
    for (let j = i + 1; j < end; j++) childIndent = Math.min(childIndent, tasks[j]!.indent);

    let done = 0;
    let total = 0;
    for (let j = i + 1; j < end; j++) {
      if (tasks[j]!.indent !== childIndent) continue;
      total++;
      if (tasks[j]!.done) done++;
    }
    if (total > 0) out.set(parent.line, { done, total });
  }
  return out;
}
