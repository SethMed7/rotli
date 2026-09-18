// The open-task line grammar, in TypeScript: the twin of corpus.rs
// `open_task_text` / `task_continuation` / `joined_task_text` / `check_off`.
// The Mac app projects and toggles tasks in Rust; Rotli Web has no Rust, so
// the same rules run here over note bodies (services/webTasks.ts). Pure.
//
// An open task is `- [ ]`, `* [ ]`, or `1. [ ]` — or the `[/]` in-progress form
// of any of them — with words after it. Checked and empty boxes are not tasks.
// A hard-wrapped task reads as ONE: indented, non-list lines directly under it
// are its continuation. Fenced code is skipped.

function stripOpenBox(rest: string): string | null {
  const tail = rest.startsWith("[ ]") || rest.startsWith("[/]") ? rest.slice(3) : null;
  if (tail === null || tail.length === 0 || !/^\s/u.test(tail)) return null;
  return tail;
}

/** `1.` → the rest (still carrying its leading space); null when not ordered. */
function stripOrderedPrefix(trimmed: string): string | null {
  const match = /^\d+\./u.exec(trimmed);
  return match ? trimmed.slice(match[0].length) : null;
}

function afterMarker(trimmed: string): string | null {
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return trimmed.slice(2);
  const ordered = stripOrderedPrefix(trimmed);
  return ordered?.startsWith(" ") ? ordered.slice(1) : null;
}

/** An open checkbox line's own words, or null. `trimmed` has no leading indent. */
export function openTaskText(trimmed: string): string | null {
  const rest = afterMarker(trimmed);
  const tail = rest === null ? null : stripOpenBox(rest);
  const text = tail?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function taskContinuation(raw: string): string | null {
  const trimmed = raw.trimStart();
  if (trimmed.length === 0) return null;
  const indent = [...raw.slice(0, raw.length - trimmed.length)].length;
  if (indent < 2 && !raw.startsWith("\t")) return null;
  const startsBlock =
    /^(?:- |\* |\+ |```|~~~|#|>|\|)/u.test(trimmed) ||
    (stripOrderedPrefix(trimmed)?.startsWith(" ") ?? false);
  return startsBlock ? null : trimmed;
}

/** The full text of the task whose checkbox sits at `start`: its line plus any
 * wrapped continuations, space-joined. The toggle re-validates against this. */
export function joinedTaskText(lines: readonly string[], start: number): string | null {
  const first = lines[start];
  let text = first === undefined ? null : openTaskText(first.trimStart());
  if (text === null) return null;
  for (const raw of lines.slice(start + 1)) {
    const continuation = taskContinuation(raw);
    if (continuation === null) break;
    text += ` ${continuation}`;
  }
  return text;
}

/** Every open task in a note body: the line it sits on and its joined text. */
export function openTasksInBody(body: string): { line: number; text: string }[] {
  const lines = body.split("\n");
  const tasks: { line: number; text: string }[] = [];
  let fenced = false;
  lines.forEach((raw, line) => {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    if (openTaskText(trimmed) === null) return;
    tasks.push({ line, text: joinedTaskText(lines, line) ?? "" });
  });
  return tasks;
}

/** Rewrite an open task's box to `[x]` BY POSITION (the three characters after
 * the list marker), so a task whose own words contain "[ ]" is never mangled.
 * Null when the line is not an open task. */
export function checkOff(line: string): string | null {
  const trimmed = line.trimStart();
  const rest = afterMarker(trimmed);
  if (rest === null || stripOpenBox(rest) === null) return null;
  const at = line.length - rest.length;
  return `${line.slice(0, at)}[x]${line.slice(at + 3)}`;
}
