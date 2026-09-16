// The note-document codec: a pure TypeScript twin of the Rust one in
// src-tauri/src/corpus.rs (`Frontmatter`, `parse_document`, `compose_document`).
// A Mac-authored note opened in the browser and written back must come out
// byte-identical apart from the fields Rotli owns, so this mirrors the Rust
// quirks deliberately — including the untrimmed key match, first-occurrence
// wins, and the trailing space an empty owned value emits.
//
// Pure: no host, no vault, no services.

/** The four facts Rotli owns, plus `origin` and every line it does not.
 * `foreign` lines are preserved verbatim, in order — never reformatted. */
export interface NoteFrontmatter {
  id: string | null;
  created: string | null;
  updated: string | null;
  pinned: boolean | null;
  /** Where a note came from before it entered Archive/Trash. `null` is absent
   * (never moved into a sink); `""` is the vault root — a deliberate, distinct
   * value. Emitted only when non-null, so untouched notes stay byte-identical. */
  origin: string | null;
  foreign: string[];
}

export function emptyFrontmatter(): NoteFrontmatter {
  return { id: null, created: null, updated: null, pinned: null, origin: null, foreign: [] };
}

/** Split like Rust's `str::lines()`: on "\n", dropping one trailing "\r" per
 * line and never yielding a trailing empty segment. Interior blank lines are
 * real (and become foreign `""` lines). */
function rustLines(head: string): string[] {
  const parts = head.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function parseFields(head: string): NoteFrontmatter {
  const fm = emptyFrontmatter();
  for (const line of rustLines(head)) {
    // Rust splits on the FIRST ':' and matches the key UNTRIMMED, so " id: x"
    // and "id : x" are foreign lines. Only the value is trimmed.
    const colon = line.indexOf(":");
    const key = colon < 0 ? null : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).trim();
    // First occurrence wins; a second `id:` line falls through to foreign.
    if (key === "id" && fm.id === null) fm.id = value;
    else if (key === "created" && fm.created === null) fm.created = value;
    else if (key === "updated" && fm.updated === null) fm.updated = value;
    else if (key === "pinned" && fm.pinned === null) fm.pinned = value === "true";
    // an empty value (`origin:`) stays "" — distinct from absent
    else if (key === "origin" && fm.origin === null) fm.origin = value;
    else fm.foreign.push(line);
  }
  return fm;
}

/** Split a document into its frontmatter and its RAW body. Tolerant by design:
 * no opening fence → no frontmatter and the whole text is the body; an
 * unterminated fence is body too, never eaten. The body is byte-exact. */
export function parseNoteDocument(text: string): { frontmatter: NoteFrontmatter | null; body: string } {
  const opener = text.startsWith("---\n") ? 4 : text.startsWith("---\r\n") ? 5 : -1;
  if (opener < 0) return { frontmatter: null, body: text };
  const rest = text.slice(opener);
  let offset = 0;
  while (offset <= rest.length) {
    const newline = rest.indexOf("\n", offset);
    const end = newline < 0 ? rest.length : newline + 1;
    const line = rest.slice(offset, end);
    if (line === "") break;
    if (line.replace(/[\n\r]+$/, "") === "---") {
      return { frontmatter: parseFields(rest.slice(0, offset)), body: rest.slice(end) };
    }
    offset = end;
  }
  return { frontmatter: null, body: text };
}

/** Serialize: the owned facts first, then every foreign line verbatim, then the
 * raw body exactly as given (the caller owns any separating blank line). */
export function composeNoteDocument(frontmatter: NoteFrontmatter, body: string): string {
  const head = [
    "---",
    `id: ${frontmatter.id ?? ""}`,
    `created: ${frontmatter.created ?? ""}`,
    `updated: ${frontmatter.updated ?? ""}`,
    `pinned: ${frontmatter.pinned ?? false}`,
    ...(frontmatter.origin === null ? [] : [`origin: ${frontmatter.origin}`]),
    ...frontmatter.foreign,
    "---",
    "",
  ].join("\n");
  return head + body;
}

const SHELF_PREFIX = "shelf:";

function shelfIndex(foreign: readonly string[]): number {
  return foreign.findIndex((line) => line.trimStart().startsWith(SHELF_PREFIX));
}

/** The user's shelf(s) from a foreign `shelf: [a, b]` (or a bare `shelf: a`)
 * line. Absent or empty ⇒ `[]`. Read-only; the file is never rewritten here. */
export function shelfOf(fm: NoteFrontmatter): string[] {
  const index = shelfIndex(fm.foreign);
  if (index < 0) return [];
  const raw = (fm.foreign[index] as string).trimStart().slice(SHELF_PREFIX.length).trim();
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Replace the existing foreign shelf line in place, or append one when the
 * note has never been shelved. Every other foreign line keeps its position. */
export function withShelf(fm: NoteFrontmatter, shelf: string[]): NoteFrontmatter {
  const line = `shelf: [${shelf.join(", ")}]`;
  const index = shelfIndex(fm.foreign);
  const foreign = [...fm.foreign];
  if (index < 0) foreign.push(line);
  else foreign[index] = line;
  return { ...fm, foreign };
}

function flagField(fm: NoteFrontmatter, key: string): boolean {
  return fm.foreign.some((line) => {
    const colon = line.indexOf(":");
    if (colon < 0) return false;
    return line.slice(0, colon).trim() === key && line.slice(colon + 1).trim() === "true";
  });
}

/** A foreign `secure: true` line — the note is categorically unavailable to
 * remote models. The vault file is the truth; this only reads it. */
export function isSecureFrontmatter(fm: NoteFrontmatter): boolean {
  return flagField(fm, "secure");
}

/** A foreign `locked: true` line — no AI may edit the note, every class reads it. */
export function isLockedFrontmatter(fm: NoteFrontmatter): boolean {
  return flagField(fm, "locked");
}
