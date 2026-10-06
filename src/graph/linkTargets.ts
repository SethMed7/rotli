// The raw `[[…]]` insides a Markdown body writes — the TS twin of
// `body_link_targets` in src-tauri/src/corpus_links.rs (same cases, same
// order): fenced blocks and inline code skipped, `![[…]]` counted, duplicates
// collapsed in first-seen order. Resolution is src/graph/model.ts's job.

export function bodyLinkTargets(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    // drop inline code spans first: `[[x]]` inside backticks is not a link
    let prose = "";
    let inCode = false;
    for (const ch of line) {
      if (ch === "`") inCode = !inCode;
      else if (!inCode) prose += ch;
    }
    let rest = prose;
    for (let start = rest.indexOf("[["); start !== -1; start = rest.indexOf("[[")) {
      const after = rest.slice(start + 2);
      const end = after.indexOf("]]");
      if (end === -1) break;
      const inner = after.slice(0, end).trim();
      if (inner && !inner.includes("[") && !out.includes(inner)) out.push(inner);
      rest = after.slice(end + 2);
    }
  }
  return out;
}

/** The raw `[[…]]` insides of a note's frontmatter `links:` line (the
 * Librarian's related notes) — the twin of `metadata_link_targets`. `fields`
 * is frontmatter lines joined by newlines; the key must start the line
 * exactly, and `links: []` is empty. */
export function metadataLinkTargets(fields: string): string[] {
  for (const line of fields.split("\n")) {
    const at = line.indexOf(":");
    if (at !== -1 && line.slice(0, at) === "links") return bodyLinkTargets(line.slice(at + 1));
  }
  return [];
}
