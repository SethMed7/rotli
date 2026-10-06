// Hand to AI (Round Three, 2026-09-26): turn a note into a prompt the user
// pastes into Claude Code or another agent. Built from the note alone, no
// model — the goal, the open and finished tasks, the files the note links to,
// the note as context, and what "done" means. Pure; the caller decides whether
// the note may leave Rotli at all (secure notes never do) and where each linked
// file lives on disk (v2, 2026-10-02: `storage:` and vault-relative links
// become paths an outside agent can open).

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X|\/)\]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const H1 = /^#\s+/;
const BLOCK_START = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/;
// `![alt](src)` or `[text](src)`, the destination in <angle brackets> or bare
// (spaces allowed, as the editor's image widget reads it), with an optional
// "title"
const LINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]+?)(?:\s+"[^"\n]*")?\)/g;
// a scheme other than `storage:` (https:, mailto:, data:, rotli:, file:…) is
// not a vault file, and neither is an absolute path or an in-page anchor
const NOT_A_VAULT_FILE = /^(?!storage:)[a-z][a-z0-9+.-]*:|^[/#~\\]/i;
// Obsidian-style width the editor keeps in the alt ("caption|420")
const WIDTH = /\s*\|\s*\d+\s*$/;

/** One file link in the note, as written. */
export interface AttachmentLink {
  /** The destination exactly as the note writes it (`storage:shot.png`). */
  src: string;
  /** Alt text or link text, minus the editor's `|width`. */
  caption: string;
  image: boolean;
}

/** Where a linked file was found. `path` is absolute on this Mac, or null where
 * Rotli has no file paths (Rotli Web), and then `rel` is what the agent gets. */
export type AttachmentPlace =
  | { status: "found"; rel: string; path: string | null }
  | { status: "missing"; rel: string };

export type Attachments = ReadonlyMap<string, AttachmentPlace>;

interface Tasks {
  open: string[];
  done: string[];
}

function destination(raw: string): string {
  return (raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw).trim();
}

/** A link to a note is a note, not an attachment: Hand to AI carries one note. */
function isVaultFile(src: string): boolean {
  return src !== "" && !NOT_A_VAULT_FILE.test(src) && !/\.md$/i.test(src.split(/[?#]/)[0] ?? "");
}

/** Run `each` on the lines outside code fences; fenced lines stay as written. */
function outsideFences(lines: readonly string[], each: (line: string) => string): string[] {
  let fenced = false;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return line;
    }
    return fenced ? line : each(line);
  });
}

/** Every distinct vault file the note links to, outside code fences, in order. */
export function attachmentLinks(body: string): AttachmentLink[] {
  const found = new Map<string, AttachmentLink>();
  outsideFences(body.split("\n"), (line) => {
    for (const [, bang = "", text = "", raw = ""] of line.matchAll(LINK)) {
      const src = destination(raw);
      if (!isVaultFile(src) || found.has(src)) continue;
      found.set(src, { src, caption: text.replace(WIDTH, "").trim(), image: bang === "!" });
    }
    return line;
  });
  return [...found.values()];
}

/** A Markdown destination an agent can follow: angle brackets when it has spaces. */
function linkTarget(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path}>` : path;
}

/** Each file link points at its real location; a missing file says so. */
function rewriteLinks(line: string, places: Attachments): string {
  return line.replace(LINK, (whole, bang: string, text: string, raw: string) => {
    const place = places.get(destination(raw));
    if (!place) return whole;
    const caption = text.replace(WIDTH, "").trim();
    if (place.status === "missing") {
      return caption ? `[missing file: ${caption} (${place.rel})]` : `[missing file: ${place.rel}]`;
    }
    return `${bang}[${caption}](${linkTarget(place.path ?? place.rel)})`;
  });
}

function attachmentSection(links: readonly AttachmentLink[], places: Attachments): string | null {
  const rows = links.flatMap((link) => {
    const place = places.get(link.src);
    if (!place) return [];
    const what = `${link.image ? "image" : "file"}${link.caption ? `, “${link.caption}”` : ""}`;
    if (place.status === "missing") return [`- ${place.rel} (${what}): missing, not found in the vault`];
    return [`- ${place.path ?? place.rel} (${what})`];
  });
  if (rows.length === 0) return null;
  const relative = links.some((link) => {
    const place = places.get(link.src);
    return place?.status === "found" && place.path === null;
  });
  const intro = relative
    ? "The note links to these files. Paths are relative to my notes folder."
    : "The note links to these files. Open them at these paths.";
  return `## Attachments\n\n${intro}\n\n${rows.join("\n")}`;
}

/** The body minus its title line. Only the first line can be the title: an
 * H1, or plain text equal to the title (Rotli's legacy title form). A `#`
 * further down (a later heading, a shell comment in a code block) stays. */
function withoutTitle(body: string, title: string): string[] {
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const line = lines[first];
  if (line !== undefined && (H1.test(line) || line.trim() === title.trim())) lines.splice(first, 1);
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

export function buildHandToAiPrompt({
  title,
  body,
  attachments = new Map(),
}: {
  title: string;
  body: string;
  /** Where each linked file is, keyed by `AttachmentLink.src`. */
  attachments?: Attachments;
}): string {
  const lines = outsideFences(withoutTitle(body, title), (line) => rewriteLinks(line, attachments));
  const tasks = tasksOf(lines);
  const files = attachmentSection(attachmentLinks(body), attachments);
  const goal = goalOf(lines) || "Carry out the work the note below describes.";
  const sections = [
    `I'm handing you work from my note "${title}". Read it all before you start.`,
    `## Goal\n\n${goal}`,
    `## Open tasks\n\n${
      tasks.open.length ? tasks.open.join("\n") : "None are written as tasks; work from the context below."
    }`,
    ...(tasks.done.length ? [`## Already done\n\n${tasks.done.join("\n")}`] : []),
    ...(files ? [files] : []),
    `## Context\n\n<note>\n${lines.join("\n")}\n</note>`,
    `## Done when\n\n- ${
      tasks.open.length ? "Every open task above is finished." : "The goal above is met."
    }\n- You tell me what you changed and anything you could not finish.`,
  ];
  return `${sections.join("\n\n")}\n`;
}
