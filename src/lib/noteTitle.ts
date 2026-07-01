// A note's title is its first non-empty line. Renaming = rewriting that line.
// Pure so it's unit-testable (the mutation path lives in useRenameNote).

/** Rewrite the FIRST non-empty line of `body` to `title`, preserving a leading
 * heading marker (`#`…`######`) if the original line had one — so a `# Heading`
 * stays a heading and a plain first line stays plain. An empty body becomes a
 * single `# title` line. Blank titles are ignored (returns the body unchanged). */
export function replaceTitleLine(body: string, title: string): string {
  const t = title.trim();
  if (!t) return body;
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  if (i < 0) return `# ${t}\n`;
  const heading = /^(\s*#{1,6})\s+/.exec(lines[i] ?? "");
  lines[i] = heading ? `${heading[1]} ${t}` : t;
  return lines.join("\n");
}
