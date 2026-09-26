// Hand to AI (Round Three, 2026-09-26): turn a note into a prompt the user
// pastes into Claude Code or another agent. First slice: built from the note
// alone, no model — the goal, the open and finished tasks, the note as
// context, and what "done" means. Pure; the caller decides whether the note
// may leave Rotli at all (secure notes never do).

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X|\/)\]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const H1 = /^#\s+/;
const BLOCK_START = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/;

interface Tasks {
  open: string[];
  done: string[];
}

/** The body minus its title line: the first H1, or else a plain first line
 * that is the title (Rotli's legacy title form). */
function withoutTitle(body: string, title: string): string[] {
  const lines = body.split("\n");
  const h1 = lines.findIndex((line) => H1.test(line));
  const first = lines.findIndex((line) => line.trim() !== "");
  const at = h1 >= 0 ? h1 : lines[first]?.trim() === title.trim() ? first : -1;
  if (at >= 0) lines.splice(at, 1);
  while (lines.length && !lines[0]?.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
  return lines;
}

/** Tasks outside code fences; `[/]` is open work already under way. */
function tasksOf(lines: readonly string[]): Tasks {
  const tasks: Tasks = { open: [], done: [] };
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    const [, mark, text = ""] = match;
    if (mark === "x" || mark === "X") tasks.done.push(`- [x] ${text}`);
    else tasks.open.push(`- [ ] ${text}${mark === "/" ? " (in progress)" : ""}`);
  }
  return tasks;
}

/** The first plain paragraph: the note's own statement of what it is for. */
function goalOf(lines: readonly string[]): string {
  const paragraph: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const plain = !fenced && line.trim() !== "" && !BLOCK_START.test(line);
    if (plain) paragraph.push(line.trim());
    else if (paragraph.length) break;
  }
  return paragraph.join(" ");
}

export function buildHandToAiPrompt({ title, body }: { title: string; body: string }): string {
  const lines = withoutTitle(body, title);
  const tasks = tasksOf(lines);
  const goal = goalOf(lines) || "Carry out the work the note below describes.";
  const sections = [
    `I'm handing you work from my note "${title}". Read it all before you start.`,
    `## Goal\n\n${goal}`,
    `## Open tasks\n\n${
      tasks.open.length ? tasks.open.join("\n") : "None are written as tasks; work from the context below."
    }`,
    ...(tasks.done.length ? [`## Already done\n\n${tasks.done.join("\n")}`] : []),
    `## Context\n\n<note>\n${lines.join("\n")}\n</note>`,
    `## Done when\n\n- ${
      tasks.open.length ? "Every open task above is finished." : "The goal above is met."
    }\n- You tell me what you changed and anything you could not finish.`,
  ];
  return `${sections.join("\n\n")}\n`;
}
