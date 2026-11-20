import { type NoteFrontmatter, parseNoteDocument } from "./frontmatter";
// Minimal writes for a folder opened in place (Obsidian, ZenNotes, plain
// Markdown) — the Rust corpus_in_place.rs twin. Owner rule 2026-10-13,
// decision B: Rotli changes only what the person asked for there. Their
// frontmatter lines stay byte-for-byte, Rotli's own facts (id, created,
// updated) are never minted, and a fence is added only to hold a line the
// person asked for (docs/design/vault-copy-and-obsidian-compatibility.md).
import { namesKey, PERMISSION_KEYS, topLevelField, topLevelKey } from "./frontmatterKeys";
import { rawFrontmatterBlock } from "./frontmatterRaw";

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
 * removal empties it; a replaced line keeps its place. Keys match untrimmed:
 * an indented line belongs to a nested map. */
export function withTopLevelLine(text: string, key: string, value: string | null): string {
  const block = rawFrontmatterBlock(text);
  const body = text.slice(block.length);
  const nl = block.includes("\r\n") || (!block && text.includes("\r\n")) ? "\r\n" : "\n";
  const lines = block
    ? block
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
        .slice(1, -1)
    : [];
  // a permission key goes in every spelling, so a typed denial never outlives
  // Rotli's own line; any other key in every one-line top-level spelling
  // (`key :`, `"key":`), so it is replaced, never repeated
  const permission = (PERMISSION_KEYS as readonly string[]).includes(key);
  const isKey = (line: string) => (permission ? namesKey(line, key) : topLevelKey(line) === key);
  const at = lines.findIndex(isKey);
  const kept = lines.filter((line) => !isKey(line));
  if (value !== null) kept.splice(at === -1 ? kept.length : Math.min(at, kept.length), 0, `${key}: ${value}`);
  if (kept.length === 0) return body;
  return `---${nl}${kept.join(nl)}${nl}---${nl}${body}`;
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
 * value differs between the note on disk (`original`) and the frontmatter a
 * Rotli action built (`next`). id, created, and updated are never written. */
export function composeInPlace(original: string, next: NoteFrontmatter): string {
  const before = parseNoteDocument(original).frontmatter;
  const beforeForeign = before?.foreign ?? [];
  // a key in any one-line top-level spelling, so `locked : false` and the
  // `locked: true` an action adds are one key, replaced in place
  const valueOf = (lines: string[], key: string) => {
    for (const line of [...lines].reverse()) {
      const field = topLevelField(line);
      if (field?.key === key) return field.value;
    }
    return null;
  };
  const keys: string[] = [];
  for (const line of [...beforeForeign, ...next.foreign]) {
    const key = topLevelKey(line);
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  let text = original;
  for (const key of keys) {
    const now = valueOf(next.foreign, key);
    if (valueOf(beforeForeign, key) !== now) text = withTopLevelLine(text, key, now);
  }
  // a permission key whose lines on disk aren't exactly the ones the action
  // built (an indented or escaped spelling beside them) is rewritten
  for (const key of PERMISSION_KEYS) {
    const naming = (lines: string[]) => lines.filter((line) => namesKey(line, key)).join("\n");
    if (naming(beforeForeign) !== naming(next.foreign))
      text = withTopLevelLine(text, key, valueOf(next.foreign, key));
  }
  if ((before?.pinned ?? false) !== (next.pinned ?? false))
    text = withTopLevelLine(text, "pinned", next.pinned ? "true" : null);
  if ((before?.origin ?? null) !== next.origin) text = withTopLevelLine(text, "origin", next.origin);
  return text;
}
