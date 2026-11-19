// How the web build reads a key only Rust writes (`created_by`, `ai_edit`,
// `local_ai_allowed`): the twin of src-tauri/src/frontmatter_keys.rs, pinned
// by parity.json (`aiBodyEditCases`, `localAiAllowedCases`). Fail closed both
// ways: a line in any spelling (indented, quoted, a list item…) whose value
// isn't a grant denies; only Rust's own spelling, `key: value` at the start
// of a line, grants; a denial wins. Values trim with `String.prototype.trim`,
// which Rust's `js_trim` matches.

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
    const close = rest.indexOf(first, 1);
    if (close < 0) return null;
    name = rest.slice(1, close);
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

export type Says = { says: "unset" } | { says: "grant"; value: string } | { says: "deny" };

/** What the fields say about one key only Rust writes (frontmatter_keys.rs `owned_key`). */
export function ownedKey(fields: readonly string[], key: string, grants: (value: string) => boolean): Says {
  let grant: string | null = null;
  for (const line of fields) {
    const field = frontmatterField(line);
    if (!field || field.key.name !== key) continue;
    if (!grants(field.value)) return { says: "deny" };
    if (field.key.canonical && grant === null) grant = field.value;
  }
  return grant === null ? { says: "unset" } : { says: "grant", value: grant };
}

/** The note's own on-device permission: true, false, or null to follow the vault. */
export function localAiAllowedOverride(fields: readonly string[]): boolean | null {
  const read = ownedKey(fields, "local_ai_allowed", (value) => value === "true");
  return read.says === "unset" ? null : read.says === "grant";
}
