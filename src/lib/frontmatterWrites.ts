// How Rotli Web removes a key from a note's frontmatter lines before writing
// its own line: the twin of src-tauri/src/frontmatter_writes.rs, held to it by
// parity.json (`removeKeyCases`). A key goes as a whole (its line, the lines
// indented under it, a `? key`'s `: value` line) and never by deleting text
// inside a block scalar (`example: |`) (Codex review of pull request 303).
import { AI_CREATORS } from "./aiEditPolicy";
import { emptyFrontmatter, isLockedFrontmatter, isSecureFrontmatter, parseNoteDocument } from "./frontmatter";
import { protectionMark } from "./frontmatterBlock";
import {
  frontmatterField,
  localAiAllowedOverride,
  namesKey,
  ownedKey,
  PERMISSION_KEYS,
  type Says,
  topLevelKey,
} from "./frontmatterKeys";

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

const UNSAFE =
  "Rotli couldn't change this safely: the note's metadata has a line for a setting that Rotli can't read or won't remove (inside a block of text, for example). Edit the note's metadata by hand.";

/** Refuse a write whose result doesn't say what the setter promised. */
export function keepPromise(holds: boolean): void {
  if (!holds) throw new Error(UNSAFE);
}

/** Refuse a write that changes how any setting it doesn't own reads (twin
 * of frontmatter_writes.rs `keeps_other_verdicts`): `read` gives each
 * setting's verdict for a written text. */
/** The settings a note's metadata decides (frontmatter_writes.rs `VERDICTS`). */
export const SETTINGS = ["created_by", "ai_edit", "local_ai_allowed", "locked", "secure"] as const;
export type Setting = (typeof SETTINGS)[number];

const SAYS_RANK = { deny: 0, unset: 1, grant: 2 } as const;

/** How each setting reads in a note's text, and how permissive that is (0 the
 * most restrictive): the twin of frontmatter_writes.rs `verdict`. */
export function settingsOf(text: string): Record<Setting, { reads: string; rank: number }> {
  const fm = parseNoteDocument(text).frontmatter ?? emptyFrontmatter();
  // a grant reads with its value, as frontmatter_writes.rs `verdict` (`Grant("agent")`)
  const says = (read: Says) => ({
    reads: read.says === "grant" ? `grant:${read.value}` : read.says,
    rank: SAYS_RANK[read.says],
  });
  const flag = (on: boolean) => ({ reads: String(on), rank: on ? 0 : 1 });
  const local = localAiAllowedOverride(fm.foreign);
  return {
    created_by: says(
      ownedKey(fm.foreign, "created_by", (value) => (AI_CREATORS as readonly string[]).includes(value)),
    ),
    ai_edit: says(ownedKey(fm.foreign, "ai_edit", (value) => value === "true")),
    local_ai_allowed: { reads: String(local), rank: local === null ? 1 : local ? 2 : 0 },
    locked: flag(isLockedFrontmatter(fm)),
    // a chat's `secureContext` taint is secure too (frontmatter_writes.rs `verdict`)
    secure: flag(isSecureFrontmatter(fm) || protectionMark(text, "secureContext")),
  };
}

/** THE guard every Web frontmatter writer runs (frontmatterWrites.test.ts
 * names each one), twin of frontmatter_writes.rs `guard_write`: a setting in
 * `owned` may change as the action says; one in `tighten` may only become
 * more restrictive; every other must read exactly as before. Throws, and the
 * caller writes nothing; returns the text it approved, the only text a writer
 * may write (frontmatterWriters.test.ts checks; Codex re-check of pull request 303). */
export function guardFrontmatterWrite(
  before: string,
  after: string,
  rule: { owned?: readonly Setting[]; tighten?: readonly Setting[] } = {},
): string {
  const [was, now] = [settingsOf(before), settingsOf(after)];
  const breaks = (key: Setting) =>
    rule.owned?.includes(key)
      ? false
      : rule.tighten?.includes(key)
        ? now[key].rank > was[key].rank
        : now[key].reads !== was[key].reads;
  if (SETTINGS.some(breaks)) throw new Error(UNSAFE);
  return after;
}
