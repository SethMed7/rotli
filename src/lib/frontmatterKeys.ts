// How the web build reads a key only Rust writes (`created_by`, `ai_edit`,
// `local_ai_allowed`): the twin of src-tauri/src/frontmatter_keys.rs, pinned
// by parity.json (`aiBodyEditCases`, `localAiAllowedCases`). Fail closed both
// ways: a line in any spelling (indented, quoted, a list item…, quoted keys
// decoded) whose value isn't a grant denies, and so does a second line naming
// the key; the frontmatter read as YAML (frontmatterYaml.ts) must agree, and
// frontmatter it refuses denies; only Rust's own spelling, `key: value` at the
// start of a line, grants. Values trim with `String.prototype.trim`, which
// Rust's `js_trim` matches.
import { decodedValue, decodeQuotedKey, UNDECIDABLE } from "./frontmatterYaml";

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
    name = decodeQuotedKey(rest.slice(0, close + 1)) ?? rest.slice(1, close);
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
  return colon < 0 ? null : { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
}

/** The key of {@link topLevelField}. */
export function topLevelKey(line: string): string | null {
  return topLevelField(line)?.key ?? null;
}

const withoutCr = (line: string) => line.replace(/\r$/, "");

/** A plain top-level line of a key other than a permission key, with its
 * value dropped (`summary: Plan: phase two` → `summary:`); every other line
 * as it is. The organizer writes `summary:` and `links:` unquoted, so this is
 * the only tolerance unreadable frontmatter gets (frontmatter_yaml.rs
 * `blank_plain_value`). */
function blankPlainValue(line: string): string {
  const field = frontmatterField(line);
  return field?.key.canonical && !(PERMISSION_KEYS as readonly string[]).includes(field.key.name)
    ? `${field.key.name}:`
    : line;
}

export type Says = { says: "unset" } | { says: "grant"; value: string } | { says: "deny" };

/** What the fields say about one key only Rust writes (frontmatter_keys.rs
 * `owned_key`): a second line naming the key, or one holding an undecidable
 * character, denies, and so does frontmatter the YAML reader refuses. */
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
  const decoded = decodedValue(fields.map(withoutCr), key, blankPlainValue);
  if (decoded.refused) return { says: "deny" };
  if (decoded.value !== null && !grants(decoded.value)) return { says: "deny" };
  if (decoded.value === null && grant !== null) return { says: "deny" };
  return grant === null ? { says: "unset" } : { says: "grant", value: grant };
}

/** The note's own on-device permission: true, false, or null to follow the vault. */
export function localAiAllowedOverride(fields: readonly string[]): boolean | null {
  const read = ownedKey(fields, "local_ai_allowed", (value) => value === "true");
  return read.says === "unset" ? null : read.says === "grant";
}
