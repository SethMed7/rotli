// The raw `[[…]]` insides a Markdown body writes — the TS twin of
// `body_link_targets` in src-tauri/src/corpus_links.rs (same cases, same
// order): fenced blocks and code spans skipped the CommonMark way (a fence
// closes on its own character at least as long; a span closes on a backtick
// run of the same length; an unmatched backtick is literal), `![[…]]` counted, duplicates
// collapsed in first-seen order. Resolution is src/graph/model.ts's job.

/** A fence line's run — three or more of one fence character, as CommonMark
 * has it — or null. An opening backtick run may not carry another backtick
 * after it. */
function fenceRun(line: string): { run: string; rest: string } | null {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(line.trimStart());
  if (!match) return null;
  const run = match[1]!;
  const rest = match[2]!;
  return run[0] === "`" && rest.includes("`") ? null : { run, rest };
}

/** A line with its code spans blanked: a run of N backticks opens a span
 * only when a run of exactly N closes it later on the line; a run with no
 * match is literal text (CommonMark). */
function outsideCode(line: string): string {
  let prose = "";
  let at = 0;
  while (at < line.length) {
    if (line[at] !== "`") {
      prose += line[at];
      at += 1;
      continue;
    }
    let run = 0;
    while (line[at + run] === "`") run += 1;
    let close = -1;
    for (let next = at + run; next < line.length;) {
      if (line[next] !== "`") {
        next += 1;
        continue;
      }
      let other = 0;
      while (line[next + other] === "`") other += 1;
      if (other === run) {
        close = next;
        break;
      }
      next += other;
    }
    if (close === -1) {
      prose += line.slice(at, at + run);
      at += run;
    } else {
      prose += " ";
      at = close + run;
    }
  }
  return prose;
}

/** A `[[…]]` naming a file, not a note — `![[budget.xlsx]]`, `[[rose.png]]`
 * (2026-10-13: Rotli writes embeds this way): the extensions the Rust
 * attachments lane (`mime_of`) knows a type for, other than Markdown. A canvas,
 * or a title with a dot ("v1.2 notes"), stays a link. The parity fixture pins
 * both sides. */
const FILE_TARGET =
  /\.(?:png|jpg|jpeg|gif|webp|bmp|svg|avif|heic|mp4|m4v|mov|webm|mp3|m4a|wav|pdf|docx|xlsx|excalidraw|csv|json|txt|log|yaml|yml|toml|tsv)$/i;
function isFileTarget(inner: string): boolean {
  return FILE_TARGET.test(inner.split(/[|#]/, 1)[0]!.trim());
}

export function bodyLinkTargets(body: string): string[] {
  const out: string[] = [];
  // the open fence's run: it closes only on the same character, at least as long
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const found = fenceRun(line);
    if (fence !== null) {
      if (found && found.run[0] === fence[0] && found.run.length >= fence.length && found.rest.trim() === "")
        fence = null;
      continue;
    }
    if (found) {
      fence = found.run;
      continue;
    }
    let rest = outsideCode(line);
    for (let start = rest.indexOf("[["); start !== -1; start = rest.indexOf("[[")) {
      const after = rest.slice(start + 2);
      const end = after.indexOf("]]");
      if (end === -1) break;
      const inner = after.slice(0, end).trim();
      if (inner && !inner.includes("[") && !isFileTarget(inner) && !out.includes(inner)) out.push(inner);
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
