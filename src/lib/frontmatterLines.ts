// How Rotli reads the permission keys off a note's frontmatter lines, with no
// YAML parser: `locked`, `secure`, and the keys only Rust writes (`ai_edit`,
// `created_by`, `local_ai_allowed`). The twin of
// src-tauri/src/frontmatter_lines.rs, character for character; the seeded
// differential harness (scripts/permission-differential.ts) and
// parity.json `permissionLineCases` hold the two to the same verdicts.
//
// The rules (decision 2026-11-20, replacing PR 303's YAML readers):
// 1. `locked`/`secure` are on for any line spelling of the key (indent, `- `,
//    `? `, quotes, a `!tag` or `&anchor`, a `{…}` flow entry, an escaped
//    quoted key) unless the value says off: `false`, `no` or `off` in any
//    case, optionally quoted, optionally followed by a `# comment`.
// 2. The same spellings deny `ai_edit`/`local_ai_allowed` and restrict
//    `created_by` with any value that doesn't grant.
// 3. A grant line continued onto a deeper plain line doesn't grant: YAML
//    reads `ai_edit: true` + `  until friday` as the text "true until friday".
// 4. A lone CR, U+0085, U+2028 and U+2029 split a line. A line they split is
//    also read whole, never grants, and can only tighten.
// Text inside a block scalar (`key: |`, `key: >-`, …) is text, as in YAML: it
// names no key. Only Rotli's own unbroken `key: value` line grants. Pure.

/** The keys these rules read. A typed fact (`id:`, `pinned:` …) whose line
 * names one is kept as a foreign line, so the readers see it. */
const PERMISSION_KEYS = ["locked", "secure", "ai_edit", "created_by", "local_ai_allowed"] as const;

interface Mention {
  /** The value, trimmed with `String.prototype.trim` (Rust `js_trim`). */
  value: string;
  /** Everything after the colon, untrimmed ("" when there is none). */
  raw: string;
  /** `key: value` at the start of the line, unquoted: Rotli's spelling. */
  canonical: boolean;
  /** At the start of the line with no `- `, `? `, tag or anchor (it may be
   * quoted): a top-level key an off-switch can remove. */
  plain: boolean;
  /** A block key (not a `{…}` flow entry). */
  block: boolean;
  /** Leading space characters before the key. */
  indent: number;
  /** The piece after the one holding the mention, where a continuation would
   * start (rule 3). */
  next: number;
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
const indentOf = (s: string) => s.length - trimStartSpace(s).length;

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

/** `text` (already trimmed at the start) past every `- `/`? ` indicator and
 * every `!tag`/`&anchor` property before a key, in any order. */
function undecorated(text: string): { rest: string; decorated: boolean; explicit: boolean } {
  let rest = text;
  let decorated = false;
  let explicit = false;
  for (;;) {
    const c = rest[0];
    if ((c === "-" || c === "?") && isSpace(rest[1])) {
      explicit ||= c === "?";
      rest = trimStartSpace(rest.slice(1));
    } else if (c === "!" || c === "&") {
      let end = 0;
      while (end < rest.length && !isSpace(rest[end])) end++;
      if (end === rest.length) break;
      rest = trimStartSpace(rest.slice(end));
    } else break;
    decorated = true;
  }
  return { rest, decorated, explicit };
}

/** The block key `text` sets, when it is `key`, in any line spelling. */
function blockMention(text: string, key: string): Mention | null {
  const indent = indentOf(text);
  const { rest, decorated, explicit } = undecorated(trimStartSpace(text));
  let canonical = indent === 0 && !decorated;
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
  if ((!explicit && !after.startsWith(":")) || name !== key) return null;
  const raw = after.startsWith(":") ? after.slice(1) : "";
  return {
    value: raw.trim(),
    raw,
    canonical,
    plain: indent === 0 && !decorated,
    block: true,
    indent,
    next: 0,
  };
}

/** Every `{…, key: value}` flow entry naming `key` in `text`, past any `? `,
 * tag or anchor before the key. */
function flowMentions(text: string, key: string, out: Mention[]): void {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== ",") continue;
    let { rest } = undecorated(trimStartSpace(text.slice(i + 1)));
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
    out.push({ value: raw.trim(), raw, canonical: false, plain: false, block: false, indent: 0, next: 0 });
  }
}

/** `s` up to its first ` #`/`\t#` comment. */
function withoutComment(s: string): string {
  for (let i = 1; i < s.length; i++)
    if (s[i] === "#" && (s[i - 1] === " " || s[i - 1] === "\t")) return s.slice(0, i);
  return s;
}

/** Does `piece` open a block scalar: `key: |`, `key: >-`, `key: |2`? A header
 * with a trailing comment doesn't count: reading less as text can only
 * tighten. */
function opensBlock(piece: string): boolean {
  const indicator = trimEndSpace(piece).replace(/[-+0-9]+$/, "");
  if (!indicator.endsWith("|") && !indicator.endsWith(">")) return false;
  const before = indicator.slice(0, -1);
  const spaced = before.replace(/[ \t]+$/, "");
  return spaced.length < before.length && spaced.endsWith(":");
}

/** A note's frontmatter lines cut into pieces at every break, each marked
 * when it is block-scalar text. */
interface Pieces {
  text: string[];
  inBlock: boolean[];
  /** The index of each line's first piece. */
  first: number[];
  whole: boolean[];
}

/** Which pieces are block-scalar text, fed one piece at a time. */
export class BlockText {
  /** The open block's header indent. */
  private open: number | null = null;

  /** Feed the next piece; true when it is text inside an open block. */
  feed(piece: string): boolean {
    const inBlock = this.open !== null && (trimSpace(piece) === "" || indentOf(piece) > this.open);
    if (!inBlock) this.open = opensBlock(piece) ? indentOf(piece) : null;
    return inBlock;
  }

  /** Feed a whole frontmatter line, piece by piece. */
  feedLine(line: string): void {
    for (const piece of segments(line).parts) this.feed(piece);
  }

  /** Would the first non-blank line of `rest` continue the open block, if it
   * came next? */
  continues(rest: readonly string[]): boolean {
    if (this.open === null) return false;
    const next = rest.find((line) => trimSpace(line) !== "");
    return next !== undefined && indentOf(next) > this.open;
  }
}

function pieces(fields: readonly string[]): Pieces {
  const out: Pieces = { text: [], inBlock: [], first: [], whole: [] };
  const block = new BlockText();
  for (const line of fields) {
    const { parts, whole } = segments(line);
    out.first.push(out.text.length);
    out.whole.push(whole);
    for (const part of parts) {
      out.inBlock.push(block.feed(part));
      out.text.push(part);
    }
  }
  return out;
}

/** Every mention of `key` on line `line`: in each piece outside a block
 * scalar, and, on a broken line, in the line read whole as well. */
function mentions(fields: readonly string[], all: Pieces, line: number, key: string): Mention[] {
  const end = all.first[line + 1] ?? all.text.length;
  const out: Mention[] = [];
  for (let at = all.first[line]!; at < end; at++) {
    if (all.inBlock[at]) continue;
    const from = out.length;
    const block = blockMention(all.text[at]!, key);
    if (block) out.push(block);
    flowMentions(all.text[at]!, key, out);
    for (const mention of out.slice(from)) mention.next = at + 1;
  }
  if (!all.whole[line] && !all.inBlock[all.first[line]!]) {
    const block = blockMention(fields[line]!.replace(/\r+$/, ""), key);
    if (block) out.push({ ...block, next: end });
  }
  return out;
}

/** Does this value say off: `false`, `no` or `off` in any case, optionally
 * quoted, optionally followed by a `# comment` (rule 1)? */
function saysOff(raw: string): boolean {
  let value = withoutComment(raw).replace(/^[ \t]+|[ \t]+$/g, "");
  for (const quote of ['"', "'"])
    if (value.length >= 2 && value.startsWith(quote) && value.endsWith(quote)) {
      value = value.slice(1, -1);
      break;
    }
  return ["false", "no", "off"].includes(value.replace(/[A-Z]/g, (c) => c.toLowerCase()));
}

/** The first line that turns `locked`/`secure` on: any mention whose value
 * doesn't say off (rule 1), or says off but continues onto a deeper plain
 * line, which YAML folds into the value (`false until friday` is no off);
 * -1 when none does. */
export function flagLine(fields: readonly string[], key: "locked" | "secure"): number {
  const all = pieces(fields);
  const on = (m: Mention) => !saysOff(m.raw) || (m.block && continued(all.text, m.next, m.indent));
  return fields.findIndex((_, line) => mentions(fields, all, line, key).some(on));
}

/** Is the note locked: any line turns `locked` on. */
export function lockedOn(fields: readonly string[]): boolean {
  return flagLine(fields, "locked") >= 0;
}

/** Is the note secure: any line turns `secure` on. */
export function secureOn(fields: readonly string[]): boolean {
  return flagLine(fields, "secure") >= 0;
}

/** Does a typed fact's line (`id:`, `pinned:` …) name a permission key, in a
 * flow entry or on a broken line? Then it stays a foreign line. */
export function namesPermissionKey(line: string): boolean {
  const all = pieces([line]);
  return PERMISSION_KEYS.some((key) => mentions([line], all, 0, key).length > 0);
}

/** Is this value all on its line: no block-scalar indicator, and any bracket
 * or quote it opens closed again? */
function onOneLine(value: string): boolean {
  const pairs = ["{}", "[]", '""', "''"];
  const balanced = ([first, last]: string) =>
    !value.startsWith(first!) || (value.length > 1 && value.endsWith(last!));
  return !value.startsWith("|") && !value.startsWith(">") && pairs.every((pair) => balanced(pair));
}

/** The first non-blank piece from `from`. */
function nextText(texts: readonly string[], from: number): string | undefined {
  return texts.slice(from).find((piece) => trimSpace(piece) !== "");
}

/** `fields` without every line an off-switch may remove as `key`'s: only a
 * top-level, single-line spelling (unbroken, at the margin with no `- `,
 * `? `, tag or anchor, its value on this line, nothing deeper after it).
 * Removing anything else could leave frontmatter YAML can't read. */
export function withoutFlag(fields: readonly string[], key: "locked" | "secure"): string[] {
  const all = pieces(fields);
  const removable = (line: number) => {
    const at = all.first[line]!;
    const mention = blockMention(fields[line]!.replace(/\r+$/, ""), key);
    const next = nextText(all.text, at + 1);
    return (
      all.whole[line]! &&
      !all.inBlock[at] &&
      mention !== null &&
      mention.plain &&
      onOneLine(trimSpace(mention.raw)) &&
      !(next !== undefined && indentOf(next) > 0)
    );
  };
  return fields.filter((_, line) => !removable(line));
}

/** Whether the first non-blank piece from `from` continues a key at `indent`
 * as YAML plain text: deeper, not a comment, not itself a `key: value`. */
function continued(texts: readonly string[], from: number, indent: number): boolean {
  const piece = nextText(texts, from);
  if (piece === undefined) return false;
  const text = trimSpace(piece);
  if (indentOf(piece) <= indent || text.startsWith("#") || text.endsWith(":")) return false;
  for (let at = text.indexOf(":"); at >= 0; at = text.indexOf(":", at + 1))
    if (isSpace(text[at + 1])) return false;
  return true;
}

export type Says = { says: "unset" } | { says: "grant"; value: string } | { says: "deny" };

/** What the fields say about one key only Rust writes (rules 2-4; Rust
 * `owned_key`): any mention on a broken line, any non-granting value, or a
 * grant continued onto a plain line denies; only Rotli's spelling grants. */
export function ownedKey(fields: readonly string[], key: string, grants: (value: string) => boolean): Says {
  const all = pieces(fields);
  let grant: string | null = null;
  for (let line = 0; line < fields.length; line++) {
    for (const mention of mentions(fields, all, line, key)) {
      if (!all.whole[line] || !grants(mention.value)) return { says: "deny" };
      if (mention.block && continued(all.text, mention.next, mention.indent)) return { says: "deny" };
      if (mention.canonical && grant === null) grant = mention.value;
    }
  }
  return grant === null ? { says: "unset" } : { says: "grant", value: grant };
}
