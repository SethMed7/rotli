// A note's tags (2026-11-24): one shared top-level `tags:` key the person, the
// Librarian, chat, and agents all read. Pure policy; the twin of
// src-tauri/src/note_tags.rs, pinned by `noteTagCases` and `noteTagEditCases`
// in scripts/fixtures/parity.json. A new tag is held to an allowlist (letters,
// numbers, -, _, /), so no value can carry a line break, a colon, a bracket, a
// quote, or a control character into the frontmatter. Tags already on disk are
// read leniently and written back exactly as they were spelled; a `tags:`
// field in a shape this reader doesn't follow is never rewritten.

import { breaksALine } from "./controlChars";
import { frontmatterField } from "./frontmatterKeys";

/** The longest tag, in characters (code points). */
export const TAG_MAX_CHARS = 40;
/** The most tags one change may add or remove. */
export const TAGS_PER_CHANGE_MAX = 32;
/** The most tags a write may leave on a note. */
export const TAGS_PER_NOTE_MAX = 100;

const YAML_WORDS = new Set(["y", "n", "yes", "no", "true", "false", "on", "off", "null"]);
const TAG_CHARS = /^[\p{Alphabetic}\p{N}_\-/]+$/u;
const CONTROL = /\p{Cc}/u;

export type TagVerdict = { ok: true; tag: string } | { ok: false; reason: string };

function readsAsNumber(tag: string): boolean {
  const lower = tag.toLowerCase();
  if (!/^[0-9]/.test(lower)) return false;
  const digits = (s: string) => /^[0-9_]+$/.test(s);
  if (digits(lower)) return true;
  if (/^0[xob][0-9a-f_]+$/.test(lower)) return true;
  const e = lower.indexOf("e");
  return e > 0 && digits(lower.slice(0, e)) && digits(lower.slice(e + 1));
}

/** Why a value can't be a tag, or null. */
export function tagRefusal(tag: string): string | null {
  const chars = [...tag];
  if (chars.length === 0) return "a tag can't be empty";
  if (chars.length > TAG_MAX_CHARS) return "a tag is at most 40 characters";
  if (!TAG_CHARS.test(tag)) return "a tag uses only letters, numbers, -, _ and /";
  if (chars[0] === "-" || chars[0] === "/" || chars.at(-1) === "/" || tag.includes("//"))
    return "a tag can't start with - or /, end with /, or hold //";
  if (YAML_WORDS.has(asciiLower(tag)) || readsAsNumber(tag))
    return "a tag can't be a bare yes/no/true/false/null word or a number";
  return null;
}

// Rust's to_ascii_lowercase: only A–Z fold
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const printable = (input: string) =>
  [...input]
    .slice(0, 60)
    .map((c) => (CONTROL.test(c) || breaksALine(c.codePointAt(0)!) ? "?" : c))
    .join("");

/** A person's or model's input as a tag: one leading `#` dropped, outer spaces
 * trimmed, NFC, then the allowlist. */
export function normalizeTag(input: string): TagVerdict {
  const trimmed = input.trim();
  const bare = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const tag = bare.normalize("NFC");
  const reason = tagRefusal(tag);
  return reason
    ? { ok: false, reason: `"${printable(input)}" can't be a tag: ${reason}` }
    : { ok: true, tag };
}

interface Item {
  raw: string;
  value: string;
  line: number | null;
}
type Form = "absent" | "empty" | "flow" | "bare" | "block";
interface Field {
  form: Form;
  line: number | null;
  items: Item[];
}

const UNREADABLE =
  "this note's tags are written in a form Rotli won't rewrite; change them in Show file metadata";

const spaceTrim = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");
const indent = (line: string) => line.length - line.replace(/^[ \t]+/, "").length;
const stripCr = (line: string) => line.replace(/\r+$/, "");

function scalar(raw: string): string | null {
  const text = spaceTrim(raw);
  if (!text || [...text].some((c) => CONTROL.test(c) || breaksALine(c.codePointAt(0)!) || c === "\u0085"))
    return null;
  for (const quote of ['"', "'"]) {
    if (text.startsWith(quote)) {
      if (text.length < 2 || !text.endsWith(quote)) return null;
      const inner = text.slice(1, -1);
      if (inner.includes(quote) || inner.includes("\\")) return null;
      return inner;
    }
  }
  if (
    /^[[\]{}&*!|>%@`#,?-]/.test(text) ||
    text.includes(": ") ||
    text.endsWith(":") ||
    text.includes(" #") ||
    /[[\]{}]/.test(text)
  )
    return null;
  return text;
}

function splitList(text: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ",") {
      parts.push(current);
      current = "";
    } else current += c;
  }
  if (quote) return null;
  parts.push(current);
  return parts;
}

function listItems(text: string, flow: boolean): Item[] | null {
  const parts = splitList(text);
  if (!parts) return null;
  if (parts.length && !spaceTrim(parts.at(-1)!) && (flow || parts.length === 1)) parts.pop();
  const items: Item[] = [];
  for (const part of parts) {
    const raw = spaceTrim(part);
    const value = scalar(raw);
    if (value === null) return null;
    items.push({ raw, value, line: null });
  }
  return items;
}

function readField(fields: readonly string[]): Field | string {
  const named = fields.flatMap((line, at) => (frontmatterField(line)?.key.name === "tags" ? [at] : []));
  if (named.length === 0) return { form: "absent", line: null, items: [] };
  if (named.length > 1) return UNREADABLE;
  const at = named[0]!;
  const line = stripCr(fields[at]!);
  if (!line.startsWith("tags:")) return UNREADABLE;
  const after = line.slice(5);
  if (after && !/^[ \t]/.test(after)) return UNREADABLE;
  const value = spaceTrim(after);
  const next = fields[at + 1] === undefined ? undefined : stripCr(fields[at + 1]!);
  if (!value) {
    const items: Item[] = [];
    let itemIndent: number | null = null;
    for (let index = at + 1; index < fields.length; index++) {
      const rawLine = stripCr(fields[index]!);
      const depth = indent(rawLine);
      const rest = rawLine.slice(depth);
      if (!rest.startsWith("- ")) {
        if ((itemIndent !== null && depth > itemIndent) || (itemIndent === null && depth > 0))
          return UNREADABLE;
        break;
      }
      if (itemIndent !== null && itemIndent !== depth) return UNREADABLE;
      itemIndent = depth;
      const item = rest.slice(2);
      const parsed = scalar(item);
      if (parsed === null) return UNREADABLE;
      items.push({ raw: spaceTrim(item), value: parsed, line: index });
    }
    return { form: items.length ? "block" : "empty", line: at, items };
  }
  if (next !== undefined && indent(next) > 0 && next.trim()) return UNREADABLE;
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return UNREADABLE;
    const items = listItems(value.slice(1, -1), true);
    return items ? { form: "flow", line: at, items } : UNREADABLE;
  }
  const items = listItems(value, false);
  return items ? { form: "bare", line: at, items } : UNREADABLE;
}

/** The tags a note carries, as written (quotes removed), in order. A field
 * this reader can't follow reads as no tags. */
export function tagValues(fields: readonly string[]): string[] {
  const field = readField(fields);
  return typeof field === "string" ? [] : field.items.map((item) => item.value);
}

const folded = (tag: string) => tag.toLowerCase();

export type TagEdit = { ok: true; fields: string[] | null } | { ok: false; reason: string };

/** The frontmatter lines with `add` (already normalized) added and every tag
 * matching one of `remove` (any case, as written on disk) taken off. Tags
 * already there keep their bytes. `fields: null` when nothing changes. */
export function applyTagChange(
  fields: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): TagEdit {
  if (add.length + remove.length > TAGS_PER_CHANGE_MAX)
    return { ok: false, reason: `one change adds or removes at most ${TAGS_PER_CHANGE_MAX} tags` };
  const field = readField(fields);
  if (typeof field === "string") return { ok: false, reason: field };
  const gone = new Set(remove.map((tag) => folded(tag.trim())));
  const kept = field.items.filter((item) => !gone.has(folded(item.value)));
  const removed = kept.length !== field.items.length;
  const added: Item[] = [];
  for (const tag of add) {
    if (tagRefusal(tag) !== null) return { ok: false, reason: `"${printable(tag)}" can't be a tag` };
    if (![...kept, ...added].some((item) => folded(item.value) === folded(tag)))
      added.push({ raw: tag, value: tag, line: null });
  }
  if (!removed && added.length === 0) return { ok: true, fields: null };
  if (kept.length + added.length > TAGS_PER_NOTE_MAX)
    return { ok: false, reason: `a note holds at most ${TAGS_PER_NOTE_MAX} tags` };
  const flow = (items: readonly Item[]) => `tags: [${items.map((item) => item.raw).join(", ")}]`;
  const out: string[] = [];
  const at = field.line;
  if (field.form === "block" && at !== null && (kept.length > 0 || added.length > 0)) {
    const itemLines = field.items.flatMap((item) => (item.line === null ? [] : [item.line]));
    const last = itemLines.at(-1) ?? at;
    const first = stripCr(fields[itemLines[0]!]!);
    const prefix = first.slice(0, indent(first));
    const ending = fields[at]!.endsWith("\r") ? "\r" : "";
    const keptLines = new Set(kept.flatMap((item) => (item.line === null ? [] : [item.line])));
    fields.forEach((line, index) => {
      if (!itemLines.includes(index) || keptLines.has(index)) out.push(line);
      if (index === last) out.push(...added.map((item) => `${prefix}- ${item.raw}${ending}`));
    });
  } else if (field.form === "absent" || at === null) {
    out.push(...fields, flow([...kept, ...added]));
  } else {
    const itemLines = new Set(field.items.flatMap((item) => (item.line === null ? [] : [item.line])));
    const ending = fields[at]!.endsWith("\r") ? "\r" : "";
    const all = [...kept, ...added];
    fields.forEach((line, index) => {
      if (index === at) out.push(`${flow(all)}${ending}`);
      else if (!itemLines.has(index)) out.push(line);
    });
  }
  return { ok: true, fields: out };
}
