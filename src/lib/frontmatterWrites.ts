// How Rotli Web removes a key from a note's frontmatter lines before writing
// its own line: the twin of src-tauri/src/frontmatter_writes.rs, held to it by
// parity.json (`removeKeyCases`). A key goes as a whole (its line, the lines
// indented under it, a `? key`'s `: value` line) and never by deleting text
// inside a block scalar (`example: |`) (Codex review of pull request 303).
import { frontmatterField, namesKey, PERMISSION_KEYS, topLevelKey } from "./frontmatterKeys";

/** Keys read in any spelling that protect a note, besides the permission keys. */
export const PROTECTION_KEYS = ["locked", "secure"] as const;

/** Whether `key` is read in any spelling (a permission or protection key). */
export function readInAnySpelling(key: string): boolean {
  return (
    (PERMISSION_KEYS as readonly string[]).includes(key) ||
    (PROTECTION_KEYS as readonly string[]).includes(key)
  );
}

const indent = (line: string) => /^[ \t]*/.exec(line)![0].length;
const blank = (line: string) => line.trim() === "";

/** Whether a line opens a block scalar (`key: |`, `key: >-`, `- |2`). */
function opensBlockScalar(line: string): boolean {
  let value = frontmatterField(line)?.value;
  if (value === undefined) {
    const rest = line.replace(/^[ \t]*/, "");
    if (!rest.startsWith("- ")) return false;
    value = rest.slice(2).trim();
  }
  return /^[|>][0-9+-]*$/.test((value.split(" #")[0] ?? "").trim());
}

/** For each line, whether it is a block scalar's text (never a key). */
export function blockScalarText(lines: readonly string[]): boolean[] {
  const text = lines.map(() => false);
  let at = 0;
  while (at < lines.length) {
    if (opensBlockScalar(lines[at]!)) {
      const header = indent(lines[at]!);
      let next = at + 1;
      while (next < lines.length && (blank(lines[next]!) || indent(lines[next]!) > header))
        text[next++] = true;
      at = next;
    } else at++;
  }
  return text;
}

function setsKey(lines: readonly string[], text: readonly boolean[], at: number, key: string): boolean {
  if (text[at]) return false;
  return readInAnySpelling(key) ? namesKey(lines[at]!, key) : topLevelKey(lines[at]!) === key;
}

/** The end (exclusive) of the key/value span starting at line `at`. */
function spanEnd(lines: readonly string[], at: number): number {
  const line = lines[at]!;
  const rest = line.replace(/^[ \t]*/, "");
  const column = indent(line) + (rest.startsWith("- ") ? 2 : 0);
  const explicit = rest.startsWith("? ");
  let end = at + 1;
  let next = at + 1;
  let tookValue = false;
  while (next < lines.length) {
    const candidate = lines[next]!;
    if (blank(candidate)) next++;
    else if (indent(candidate) > column) end = ++next;
    else if (
      explicit &&
      !tookValue &&
      indent(candidate) === column &&
      candidate.trimStart().startsWith(":")
    ) {
      tookValue = true;
      end = ++next;
    } else break;
  }
  return end;
}

/** Every line of every span that sets `key`, in order. */
export function keyLines(lines: readonly string[], key: string): string[] {
  const text = blockScalarText(lines);
  const out: string[] = [];
  let at = 0;
  while (at < lines.length) {
    if (setsKey(lines, text, at, key)) {
      const end = spanEnd(lines, at);
      out.push(...lines.slice(at, end));
      at = end;
    } else at++;
  }
  return out;
}

/** Every span that sets `key` removed, and the index where the first began
 * (-1 when none did). A list item's first key going hands its dash on. */
export function removeKey(lines: readonly string[], key: string): { lines: string[]; at: number } {
  const out = [...lines];
  let first = -1;
  let at = 0;
  for (;;) {
    const text = blockScalarText(out);
    let start = -1;
    for (let i = at; i < out.length; i++)
      if (setsKey(out, text, i, key)) {
        start = i;
        break;
      }
    if (start < 0) return { lines: out, at: first };
    const end = spanEnd(out, start);
    const dashAt = indent(out[start]!);
    const dash = out[start]!.slice(dashAt).startsWith("- ");
    out.splice(start, end - start);
    const sibling = out[start];
    if (dash && sibling !== undefined && !blank(sibling) && indent(sibling) === dashAt + 2)
      out[start] = `${sibling.slice(0, dashAt)}- ${sibling.slice(dashAt + 2)}`;
    if (first < 0) first = start;
    at = start;
  }
}

/** Refuse a write whose result doesn't say what the setter promised. */
export function keepPromise(holds: boolean): void {
  if (!holds)
    throw new Error(
      "Rotli couldn't change this setting safely: the note's metadata has another line for it that Rotli won't remove (inside a block of text, for example). Edit the note's metadata by hand.",
    );
}
