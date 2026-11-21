// How Rotli reads the permission keys off a note's frontmatter lines, with no
// YAML parser: `locked`, `secure`, and the keys only Rust writes (`ai_edit`,
// `created_by`, `local_ai_allowed`). The twin of
// src-tauri/src/frontmatter_lines.rs, character for character; the seeded
// differential harness (scripts/permission-differential.ts) and
// parity.json `permissionLineCases` hold the two to the same verdicts.
//
// The rules (decision 2026-11-20, replacing PR 303's YAML readers):
// 1. `locked`/`secure` are on for any line spelling of the key (indent, `- `,
//    `? `, quotes, a `!tag`, a `{…}` flow entry, an escaped quoted key) whose
//    value isn't exactly `false`.
// 2. The same spellings deny `ai_edit`/`local_ai_allowed` and restrict
//    `created_by` with any value that doesn't grant.
// 3. A grant line continued onto a deeper plain line doesn't grant: YAML
//    reads `ai_edit: true` + `  until friday` as the text "true until friday".
// 4. A lone CR, U+0085, U+2028 and U+2029 split a line. A line they split is
//    also read whole, never grants, and can only tighten.
// Only Rotli's own unbroken `key: value` line grants. Pure.

export interface Mention {
  /** The value, trimmed with `String.prototype.trim` (Rust `js_trim`). */
  value: string;
  /** Everything after the colon, untrimmed ("" when there is none). */
  raw: string;
  /** `key: value` at the start of the line, unquoted: Rotli's spelling. */
  canonical: boolean;
  /** A block key (not a `{…}` flow entry). */
  block: boolean;
  /** Leading space characters before the key. */
  indent: number;
}

const BREAKS = /[\r\n\u0085\u2028\u2029]/;

/** Unicode White_Space plus U+FEFF: JavaScript's `\s` with U+0085 added. */
function isSpace(c: string | undefined): boolean {
  return c !== undefined && (c === "\u0085" || /\s/.test(c));
}

function trimStartSpace(s: string): string {
  let i = 0;
  while (i < s.length && isSpace(s[i])) i++;
  return s.slice(i);
}

function trimEndSpace(s: string): string {
  let i = s.length;
  while (i > 0 && isSpace(s[i - 1])) i--;
  return s.slice(0, i);
}

const trimSpace = (s: string) => trimEndSpace(trimStartSpace(s));

/** A physical frontmatter line without its trailing CRs, split at every break
 * left inside it; `whole` when nothing split it. */
export function segments(line: string): { parts: string[]; whole: boolean } {
  const parts = line.replace(/\r+$/, "").split(BREAKS);
  return { parts, whole: parts.length === 1 };
}

/** A quoted key starting at `rest[0]`, decoded: its name and where it ends.
 * Null when it never closes or an escape doesn't name a character. */
function quoted(rest: string, quote: string): { name: string; end: number } | null {
  let name = "";
  let i = 1;
  while (i < rest.length) {
    const c = rest[i]!;
    if (quote === "'") {
      if (c !== "'") {
        name += c;
        i++;
      } else if (rest[i + 1] === "'") {
        name += "'";
        i += 2;
      } else return { name, end: i + 1 };
      continue;
    }
    if (c === '"') return { name, end: i + 1 };
    if (c !== "\\") {
      name += c;
      i++;
      continue;
    }
    const escaped = rest[i + 1];
    if (escaped === undefined) return null;
    const width = escaped === "x" ? 2 : escaped === "u" ? 4 : escaped === "U" ? 8 : 0;
    if (width) {
      const hex = rest.slice(i + 2, i + 2 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) return null;
      const code = parseInt(hex, 16);
      if ((code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return null;
      name += String.fromCodePoint(code);
      i += 2 + width;
      continue;
    }
    name +=
      escaped === "n"
        ? "\n"
        : escaped === "t"
          ? "\t"
          : escaped === "r"
            ? "\r"
            : escaped === "0"
              ? "\0"
              : escaped;
    i += 2;
  }
  return null;
}

/** The block key `text` sets, when it is `key`, in any line spelling. */
function blockMention(text: string, key: string): Mention | null {
  let rest = trimStartSpace(text);
  const indent = text.length - rest.length;
  let canonical = indent === 0;
  let explicit = false;
  for (;;) {
    const c = rest[0];
    if ((c !== "-" && c !== "?") || !isSpace(rest[1])) break;
    rest = trimStartSpace(rest.slice(1));
    canonical = false;
    explicit ||= c === "?";
  }
  if (rest.startsWith("!")) {
    let end = 0;
    while (end < rest.length && !isSpace(rest[end])) end++;
    if (end === rest.length) return null;
    rest = trimStartSpace(rest.slice(end));
    canonical = false;
  }
  if (rest.startsWith("#")) return null;
  let name: string;
  let after: string;
  const first = rest[0];
  if (first === '"' || first === "'") {
    canonical = false;
    const read = quoted(rest, first);
    if (!read) return null;
    name = read.name;
    after = trimStartSpace(rest.slice(read.end));
  } else {
    const colon = rest.indexOf(":");
    if (colon >= 0) {
      const raw = rest.slice(0, colon);
      canonical &&= raw === trimEndSpace(raw);
      name = trimSpace(raw);
      after = rest.slice(colon);
    } else if (explicit) {
      name = trimSpace(rest);
      after = "";
    } else return null;
  }
  if (!explicit && !after.startsWith(":")) return null;
  if (name !== key) return null;
  const raw = after.startsWith(":") ? after.slice(1) : "";
  return { value: raw.trim(), raw, canonical, block: true, indent };
}

/** Every `{…, key: value}` flow entry naming `key` in `text`. */
function flowMentions(text: string, key: string, out: Mention[]): void {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== ",") continue;
    let rest = trimStartSpace(text.slice(i + 1));
    let name: string;
    const first = rest[0];
    if (first === '"' || first === "'") {
      const read = quoted(rest, first);
      if (!read) continue;
      name = read.name;
      rest = trimStartSpace(rest.slice(read.end));
    } else {
      let end = 0;
      while (end < rest.length && !":,{}\"'".includes(rest[end]!)) end++;
      name = trimSpace(rest.slice(0, end));
      rest = rest.slice(end);
    }
    if (name !== key || !rest.startsWith(":")) continue;
    let end = 1;
    while (end < rest.length && rest[end] !== "," && rest[end] !== "}") end++;
    const raw = rest.slice(1, end);
    out.push({ value: raw.trim(), raw, canonical: false, block: false, indent: 0 });
  }
}

/** Every mention of `key` on one physical line: in each piece a break leaves,
 * and, on a broken line, in the line read whole as well. */
export function lineMentions(line: string, key: string): { mentions: Mention[]; whole: boolean } {
  const { parts, whole } = segments(line);
  const mentions: Mention[] = [];
  for (const part of parts) {
    const block = blockMention(part, key);
    if (block) mentions.push(block);
    flowMentions(part, key, mentions);
  }
  if (!whole) {
    const block = blockMention(line.replace(/\r+$/, ""), key);
    if (block) mentions.push(block);
  }
  return { mentions, whole };
}

/** `locked`/`secure` on one line: true when any spelling of the key holds a
 * value other than exactly `false`, false when every one says `false`, null
 * when the line doesn't name it (rule 1; Rust `flag_field`). */
export function lineFlag(line: string, key: "locked" | "secure"): boolean | null {
  const { mentions } = lineMentions(line, key);
  if (!mentions.length) return null;
  return mentions.some((mention) => mention.raw.replace(/^[ \t]+|[ \t]+$/g, "") !== "false");
}

/** Is the note locked: any line turns `locked` on. */
export function lockedOn(fields: readonly string[]): boolean {
  return fields.some((line) => lineFlag(line, "locked") === true);
}

/** Is the note secure: any line turns `secure` on. */
export function secureOn(fields: readonly string[]): boolean {
  return fields.some((line) => lineFlag(line, "secure") === true);
}

/** Whether the first non-blank piece from `from` continues a key at `indent`
 * as YAML plain text: deeper, not a comment, not itself a `key: value`. */
function continued(pieces: readonly string[], from: number, indent: number): boolean {
  for (let i = from; i < pieces.length; i++) {
    const text = trimSpace(pieces[i]!);
    if (!text) continue;
    const lead = pieces[i]!.length - trimStartSpace(pieces[i]!).length;
    if (lead <= indent || text.startsWith("#") || text.endsWith(":")) return false;
    for (let at = text.indexOf(":"); at >= 0; at = text.indexOf(":", at + 1))
      if (isSpace(text[at + 1])) return false;
    return true;
  }
  return false;
}

export type Says = { says: "unset" } | { says: "grant"; value: string } | { says: "deny" };

/** What the fields say about one key only Rust writes (rules 2-4; Rust
 * `owned_key`): any mention on a broken line, any non-granting value, or a
 * grant continued onto a plain line denies; only Rotli's spelling grants. */
export function ownedKey(fields: readonly string[], key: string, grants: (value: string) => boolean): Says {
  const pieces: string[] = [];
  const first: number[] = [];
  for (const line of fields) {
    first.push(pieces.length);
    pieces.push(...segments(line).parts);
  }
  let grant: string | null = null;
  for (let i = 0; i < fields.length; i++) {
    const { mentions, whole } = lineMentions(fields[i]!, key);
    for (const mention of mentions) {
      if (!whole || !grants(mention.value)) return { says: "deny" };
      if (mention.block && continued(pieces, first[i]! + 1, mention.indent)) return { says: "deny" };
      if (mention.canonical && grant === null) grant = mention.value;
    }
  }
  return grant === null ? { says: "unset" } : { says: "grant", value: grant };
}
