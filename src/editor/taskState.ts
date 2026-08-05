// The checkbox grammar — ONE definition of what a task's mark may be.
//
// rotli understands three: `[ ]` open · `[/]` in progress · `[x]` done (Seth,
// 2026-08-04, from ZenNotes: "offer partial complete"). `[/]` is the
// convention Obsidian's task plugins and ZenNotes already use, so a note
// written in one reads correctly in the other.
//
// WHY THIS FILE EXISTS: before it, the checkbox pattern was written out by hand
// in nine places across TypeScript and Rust — the block parser, the live
// preview, the block commands, the Enter/Space keymap, the buffer's task
// counter, two markdown strippers, the corpus's Tasks projection, and the
// workspace metrics. Adding a third mark to nine independent regexes is exactly
// how a grammar drifts. The TS half now shares MARK; the Rust half is held to
// it by tests on both sides.
//
// Pure: no CodeMirror, no DOM, no store.

/** Every mark a checkbox may carry, as a regex character class. */
export const MARK = "[ xX/]";

export type TaskState = "open" | "doing" | "done";

/** `- [ ] x` — the plain task. Capture 1 is the mark. */
export const TASK_RE = new RegExp(`^- \\[(${MARK})\\] `);
/** GFM's ordered task, `1. [ ] x`. Capture 1 is the number, 2 the mark. */
export const ORDERED_TASK_RE = new RegExp(`^(\\d+)\\. \\[(${MARK})\\] `);
/** Either kind, with its leading indent and list marker — used where a whole
 * task line is matched for rewriting. Capture 1 is everything up to the box,
 * capture 2 the mark. */
export const TASK_LINE_RE = new RegExp(`^(\\s*(?:-|\\d+\\.) )\\[(${MARK})\\] `);

export function taskStateOf(mark: string): TaskState {
  if (mark === "/") return "doing";
  return mark === " " ? "open" : "done";
}

export function markOf(state: TaskState): string {
  if (state === "doing") return "/";
  return state === "done" ? "x" : " ";
}

/**
 * Where a CLICK on the box moves the state.
 *
 * With `threeState` off (the default) the box behaves the way it always has:
 * open⇄done, one click each way — and a `[/]` typed by hand still checks off
 * in one click rather than becoming a two-step chore.
 *
 * With it on, the click walks open → doing → done → open, which is the
 * "click once for in progress and again for complete" the setting exists for.
 * Typing `[/]` yourself works either way; the setting only governs the click.
 */
export function nextTaskState(state: TaskState, threeState: boolean): TaskState {
  if (state === "done") return "open";
  if (!threeState) return "done";
  return state === "open" ? "doing" : "done";
}
