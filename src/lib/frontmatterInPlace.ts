import { type NoteFrontmatter, parseNoteDocument } from "./frontmatter";
// Minimal writes for a folder opened in place (Obsidian, ZenNotes, plain
// Markdown) — the Rust corpus_in_place.rs twin. Owner rule 2026-10-13,
// decision B: Rotli changes only what the person asked for there. Their
// frontmatter lines stay byte-for-byte, Rotli's own facts (id, created,
// updated) are never minted, and a fence is added only to hold a line the
// person asked for (docs/design/vault-copy-and-obsidian-compatibility.md).
import { frontmatterField, topLevelKey } from "./frontmatterKeys";
import { rawFrontmatterBlock } from "./frontmatterRaw";
import { keyLines, readInAnySpelling, removeKey } from "./frontmatterWrites";

/** A ULID (Crockford base32, 26 characters) — every Rotli create path mints one. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** A note Rotli itself made. Anything else in a folder opened in place is the
 * person's own note, which Rotli never renames or stamps; Obsidian ids
 * (timestamps, slugs) are not ULIDs. */
export function rotliMade(fm: NoteFrontmatter | null): boolean {
  return !!fm?.id && ULID.test(fm.id);
}

/** Set (a string) or remove (`null`) one top-level frontmatter line, keeping
 * every other byte. A fence is added only to hold a new line and goes when
 * removal empties it; a replaced line keeps its place. */
export function withTopLevelLine(text: string, key: string, value: string | null): string {
  return withKeyLines(text, key, value === null ? [] : [`${key}: ${value}`]);
}

/** Replace every span that sets `key` (frontmatterWrites.ts: its line, the
 * lines under it, never block text; a permission or protection key in any
 * spelling) with `replacement`, verbatim, where the first one was; a new key
 * goes last. Twin of corpus_in_place.rs `with_key_lines`. */
export function withKeyLines(text: string, key: string, replacement: readonly string[]): string {
  const block = rawFrontmatterBlock(text);
  const body = text.slice(block.length);
  const nl = block.includes("\r\n") || (!block && text.includes("\r\n")) ? "\r\n" : "\n";
  const lines = block
    ? block
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
        .slice(1, -1)
    : [];
  const removed = removeKey(lines, key);
  const at = removed.at < 0 ? removed.lines.length : removed.at;
  removed.lines.splice(at, 0, ...replacement);
  if (removed.lines.length === 0) return body;
  return `---${nl}${removed.lines.join(nl)}${nl}---${nl}${body}`;
}

/** Add or remove only the secure lines (removal also drops the local-AI
 * override and the secure-origin breadcrumb). */
export function withSecureLineOnly(text: string, secure: boolean): string {
  if (secure) return withTopLevelLine(text, "secure", "true");
  let out = withTopLevelLine(text, "secure", null);
  out = withTopLevelLine(out, "local_ai_allowed", null);
  return withTopLevelLine(out, "secure_origin", null);
}

/** A metadata change in a folder opened in place: apply only the keys whose
 * lines differ between the note on disk (`original`) and the frontmatter a
 * Rotli action built (`next`), copying the action's lines verbatim (never a
 * line built from a decoded value, so a typed `"ai_edit": true` stays typed;
 * Codex review of pull request 303, items 1 and 2). id, created, and updated are never
 * written. Twin of corpus_in_place.rs `compose_in_place`. */
export function composeInPlace(original: string, next: NoteFrontmatter): string {
  const before = parseNoteDocument(original).frontmatter;
  const beforeForeign = before?.foreign ?? [];
  // a permission or protection key in any spelling; any other in its one-line
  // top-level spellings (`locked : false`, `"locked": false`, `locked: true`)
  const identity = (line: string) => {
    const name = frontmatterField(line)?.key.name;
    return name !== undefined && readInAnySpelling(name) ? name : topLevelKey(line);
  };
  const keys: string[] = [];
  for (const line of [...beforeForeign, ...next.foreign]) {
    const key = identity(line);
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  let text = original;
  for (const key of keys) {
    const now = keyLines(next.foreign, key);
    if (keyLines(beforeForeign, key).join("\n") !== now.join("\n")) text = withKeyLines(text, key, now);
  }
  if ((before?.pinned ?? false) !== (next.pinned ?? false))
    text = withTopLevelLine(text, "pinned", next.pinned ? "true" : null);
  if ((before?.origin ?? null) !== next.origin) text = withTopLevelLine(text, "origin", next.origin);
  return text;
}
