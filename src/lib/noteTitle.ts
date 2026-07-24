// A note's title is its first H1. Renaming rewrites that H1; an older H1-less
// note adopts an H1 by replacing its legacy first non-empty title line.
// Pure so it's unit-testable (the mutation path lives in useRenameNote).

/** Rewrite the first H1. If none exists, replace the legacy first non-empty
 * title line with an H1. An empty body becomes a single H1. */
export function replaceTitleLine(body: string, title: string): string {
  const t = title.trim();
  if (!t) return body;
  const lines = body.split("\n");
  const h1 = lines.findIndex((line) => /^\s*#(?:\s|$)/.test(line) && !/^\s*##/.test(line));
  const i = h1 >= 0 ? h1 : lines.findIndex((l) => l.trim() !== "");
  if (i < 0) return `# ${t}\n`;
  const indent = /^(\s*)/.exec(lines[i] ?? "")?.[1] ?? "";
  lines[i] = `${indent}# ${t}`;
  return lines.join("\n");
}
