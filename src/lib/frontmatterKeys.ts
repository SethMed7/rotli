// How the web build reads a key only Rust writes (`created_by`, `ai_edit`,
// `local_ai_allowed`): the twin of src-tauri/src/frontmatter_keys.rs, pinned
// by parity.json (`aiBodyEditCases`, `localAiAllowedCases`). Fail closed both
// ways: a line in any spelling (indented, quoted, a list item…, quoted keys
// decoded) whose value isn't a grant denies, and so does a second line naming
// the key; where the frontmatter decodes as YAML the decoded value must
// agree; frontmatter that won't decode denies only through a line about the
// key; only Rust's own spelling, `key: value` at the start of a line, grants.
// Values trim with `String.prototype.trim`, which Rust's `js_trim` matches.
import { isCollection, parse as parseYaml, parseDocument, visit } from "yaml";

/** The keys that grant or deny an AI permission; every writer clears every spelling. */
export const PERMISSION_KEYS = ["created_by", "ai_edit", "local_ai_allowed"] as const;

export interface FrontmatterKey {
  name: string;
  /** `key: value` at the start of the line, unquoted, no space before the colon. */
  canonical: boolean;
}

/** A line's key in any YAML spelling and its trimmed value, or null. */
export function frontmatterField(line: string): { key: FrontmatterKey; value: string } | null {
  const bare = line.replace(/\r+$/, "");
  let rest = bare.trimStart();
  let canonical = rest.length === bare.length;
  let explicit = false;
  for (;;) {
    if (rest.startsWith("- ")) {
      rest = rest.slice(2).trimStart();
      canonical = false;
    } else if (rest.startsWith("? ")) {
      rest = rest.slice(2).trimStart();
      canonical = false;
      explicit = true;
    } else break;
  }
  if (rest.startsWith("#")) return null;
  let name: string;
  let after: string;
  const first = rest[0];
  if (first === '"' || first === "'") {
    canonical = false;
    const close = quotedEnd(rest, first);
    if (close < 0) return null;
    name = decodeScalar(rest.slice(0, close + 1)) ?? rest.slice(1, close);
    after = rest.slice(close + 1);
  } else {
    const colon = rest.indexOf(":");
    if (colon >= 0) {
      const raw = rest.slice(0, colon);
      canonical &&= raw === raw.trimEnd();
      name = raw.trim();
      after = rest.slice(colon);
    } else if (explicit) {
      name = rest.trim();
      after = "";
    } else return null;
  }
  after = after.trimStart();
  if (!explicit && !after.startsWith(":")) return null;
  if (!name || (/\s/.test(name) && !explicit)) return null;
  return { key: { name, canonical }, value: (after.startsWith(":") ? after.slice(1) : "").trim() };
}

/** The index of the quote closing the quoted scalar `rest` starts with. */
function quotedEnd(rest: string, quote: string): number {
  for (let at = 1; at < rest.length; at++) {
    const c = rest[at];
    if (quote === '"' && c === "\\") at++;
    else if (c === quote) {
      if (quote === "'" && rest[at + 1] === "'") at++;
      else return at;
    }
  }
  return -1;
}

/** A quoted YAML scalar, decoded by the YAML parser; null when it won't parse. */
function decodeScalar(token: string): string | null {
  try {
    const value: unknown = parseYaml(token);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Whether a frontmatter line names `key` in any spelling, quoted keys decoded. */
export function namesKey(line: string, key: string): boolean {
  return frontmatterField(line)?.key.name === key;
}

/** The key and value a top-level line sets in a one-line spelling (`key:`,
 * `key :`, `"key":`, quoted keys decoded); null for an indented line, a list
 * item, `? key`, or a line without a colon. A key the line reader doesn't name
 * (one with a space inside, as Obsidian's `date created`) is its text before
 * the colon. Twin of frontmatter_keys.rs `top_level_field`: a write in a
 * folder opened in place replaces this line. */
export function topLevelField(raw: string): { key: string; value: string } | null {
  const line = raw.replace(/\r$/, "");
  if (/^\s/.test(line) || line.startsWith("- ") || line.startsWith("? ")) return null;
  const field = frontmatterField(line);
  if (field) return { key: field.key.name, value: field.value };
  const colon = line.indexOf(":");
  return colon < 0 ? null : { key: line.slice(0, colon), value: line.slice(colon + 1).trim() };
}

/** The key of {@link topLevelField}. */
export function topLevelKey(line: string): string | null {
  return topLevelField(line)?.key ?? null;
}

/** C0 and C1 controls other than tab and line feed, and U+FEFF: the two YAML
 * parsers could read them differently, so a line about a key holding one
 * denies that key, and frontmatter holding one elsewhere isn't decoded. */
// eslint-disable-next-line no-control-regex
const UNDECIDABLE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\ufeff]/;

/** A single mapping's top-level value of the key as text (null when absent),
 * or `unreadable` when the frontmatter won't decode, isn't one mapping,
 * repeats a key, or holds an undecidable character. */
type Decoded = { readable: true; value: string | null } | { readable: false };

const withoutCr = (line: string) => line.replace(/\r$/, "");

/** The most frontmatter the decoder reads, in UTF-8 bytes, and the deepest
 * nesting it accepts; past either it says nothing (the line rules still
 * apply). Twins of frontmatter_keys.rs `DECODE_MAX_BYTES`/`DECODE_MAX_DEPTH`,
 * which bound yaml-rust2's alias copying and recursion; an alias is refused
 * on both sides for the same reason. */
const DECODE_MAX_BYTES = 64 * 1024;
const DECODE_MAX_DEPTH = 64;

/** Twin of frontmatter_keys.rs `decoded_value` (and its `affordable`). */
function decodedValue(fields: readonly string[], key: string): Decoded {
  const lines = fields.map(withoutCr);
  if (lines.some((line) => UNDECIDABLE.test(line))) return { readable: false };
  const block = lines.join("\n");
  if (new TextEncoder().encode(block).length > DECODE_MAX_BYTES) return { readable: false };
  let doc: unknown;
  try {
    const parsed = parseDocument(block, { uniqueKeys: true });
    if (parsed.errors.length > 0) return { readable: false };
    let affordable = true;
    visit(parsed, {
      Alias() {
        affordable = false;
        return visit.BREAK;
      },
      Collection(_key, _node, path) {
        if (path.filter((ancestor) => isCollection(ancestor)).length + 1 <= DECODE_MAX_DEPTH)
          return undefined;
        affordable = false;
        return visit.BREAK;
      },
    });
    if (!affordable) return { readable: false };
    doc = parsed.toJS();
  } catch {
    return { readable: false };
  }
  if (doc === null || doc === undefined) return { readable: true, value: null };
  if (typeof doc !== "object" || Array.isArray(doc) || doc instanceof Map) return { readable: false };
  if (!Object.prototype.hasOwnProperty.call(doc, key)) return { readable: true, value: null };
  const value = (doc as Record<string, unknown>)[key];
  if (typeof value === "boolean" || typeof value === "number")
    return { readable: true, value: String(value) };
  if (typeof value === "string") return { readable: true, value };
  if (value === null) return { readable: true, value: "" };
  return { readable: true, value: "\u0000" }; // a list, a map: grants nothing
}

/** Whether a line the line reader doesn't name as `key` still contains the
 * key's text (`!!str ai_edit: false`, `{ai_edit: false}`, a value that
 * mentions it): in frontmatter that won't decode it might be a denial nobody
 * can read, so it denies (frontmatter_keys.rs `mentioned_unnamed`). */
function mentionedUnnamed(fields: readonly string[], key: string): boolean {
  return fields.some((line) => line.includes(key) && !namesKey(line, key));
}

export type Says = { says: "unset" } | { says: "grant"; value: string } | { says: "deny" };

/** What the fields say about one key only Rust writes (frontmatter_keys.rs
 * `owned_key`): a second line naming the key, or one holding an undecidable
 * character, denies; frontmatter that won't decode says nothing by itself. */
export function ownedKey(fields: readonly string[], key: string, grants: (value: string) => boolean): Says {
  let grant: string | null = null;
  let named = false;
  for (const raw of fields) {
    const line = withoutCr(raw);
    const field = frontmatterField(line);
    if (!field || field.key.name !== key) continue;
    if (named || !grants(field.value) || UNDECIDABLE.test(line)) return { says: "deny" };
    named = true;
    if (field.key.canonical) grant = field.value;
  }
  const decoded = decodedValue(fields, key);
  if (decoded.readable) {
    if (decoded.value !== null && !grants(decoded.value)) return { says: "deny" };
    if (decoded.value === null && grant !== null) return { says: "deny" };
  } else if (mentionedUnnamed(fields, key)) return { says: "deny" };
  return grant === null ? { says: "unset" } : { says: "grant", value: grant };
}

/** The note's own on-device permission: true, false, or null to follow the vault. */
export function localAiAllowedOverride(fields: readonly string[]): boolean | null {
  const read = ownedKey(fields, "local_ai_allowed", (value) => value === "true");
  return read.says === "unset" ? null : read.says === "grant";
}
