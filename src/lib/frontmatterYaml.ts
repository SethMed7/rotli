// How the web build reads one permission key out of a note's frontmatter as
// YAML, for frontmatterKeys.ts `ownedKey`: the twin of
// src-tauri/src/frontmatter_yaml.rs, held to one verdict by parity.json
// (`aiBodyEditCases`, `localAiAllowedCases`). The frontmatter is any file's,
// so the work is bounded before the parser runs (bytes, `[`/`{` nesting),
// nothing is converted to JavaScript values, and only the root mapping's keys
// are read. Key identity is "a scalar whose text is the key"; a repeat is
// counted for the one key asked about and nothing else, so neither library's
// duplicate or number rules decide anything (Codex review of pull request 303).
import { isAlias, isMap, isPair, isScalar, isSeq, parse as parseYaml, parseDocument } from "yaml";

/** The most frontmatter read, in UTF-8 bytes, and the deepest nesting
 * accepted; past either the frontmatter is refused, which denies. */
export const DECODE_MAX_BYTES = 64 * 1024;
export const DECODE_MAX_DEPTH = 64;
/** The longest quoted key decoded on its own line (frontmatter_yaml.rs
 * `QUOTED_KEY_MAX_BYTES`): no escaped permission key is longer. */
const QUOTED_KEY_MAX_BYTES = 256;

/** C0 and C1 controls other than tab and line feed, and U+FEFF: the two YAML
 * parsers could read them differently. */
// eslint-disable-next-line no-control-regex
export const UNDECIDABLE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f﻿]/;

/** The key's value in the root mapping as its source text (`\0` for a list, a
 * map or an alias; null when absent), or refused: over budget, an alias as a
 * root key, the key twice, more than one document, an undecidable character,
 * or unreadable even with plain values blanked. Refused denies. */
export type Decoded = { refused: false; value: string | null } | { refused: true };

const REFUSED: Decoded = { refused: true };
const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** The deepest `[`/`{` nesting, counted without regard to YAML. */
function bracketDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  for (const c of text) {
    if (c === "[" || c === "{") deepest = Math.max(deepest, ++depth);
    else if (c === "]" || c === "}") depth = Math.max(0, depth - 1);
  }
  return deepest;
}

/** A node's source text: a string scalar's value, any other scalar's source
 * (`1.0` stays `1.0`, `True` stays `True`), `\0` for anything else. */
function sourceText(node: unknown): string {
  if (!isScalar(node)) return "\u0000";
  if (typeof node.value === "string") return node.value;
  if (node.source !== undefined) return node.source;
  const value: unknown = node.value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

/** The deepest collection nesting under `root`, walked without recursion. */
function nesting(root: unknown): number {
  let deepest = 0;
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length > 0) {
    const [node, above] = stack.pop()!;
    if (isMap(node) || isSeq(node)) {
      deepest = Math.max(deepest, above + 1);
      for (const item of node.items) {
        if (isPair(item)) stack.push([item.key, above + 1], [item.value, above + 1]);
        else stack.push([item, above + 1]);
      }
    }
  }
  return deepest;
}

/** One read of the text; null when it won't parse. */
function readRoot(block: string, key: string): Decoded | null {
  const doc = parseDocument(block, { uniqueKeys: false });
  if (doc.errors.length > 0) return null;
  if (nesting(doc.contents) > DECODE_MAX_DEPTH) return REFUSED;
  if (!isMap(doc.contents)) return { refused: false, value: null };
  const found: string[] = [];
  for (const pair of doc.contents.items) {
    if (isAlias(pair.key)) return REFUSED;
    if (isScalar(pair.key) && sourceText(pair.key) === key) found.push(sourceText(pair.value));
  }
  return found.length > 1 ? REFUSED : { refused: false, value: found[0] ?? null };
}

/** The value of `key` in the root mapping. Frontmatter that won't parse is
 * read once more through `blank` (the values of plain non-permission keys
 * dropped); still unreadable, it is refused. Twin of `decoded_value`. */
export function decodedValue(
  lines: readonly string[],
  key: string,
  blank: (line: string) => string,
): Decoded {
  const block = lines.join("\n");
  if (utf8Length(block) > DECODE_MAX_BYTES || bracketDepth(block) > DECODE_MAX_DEPTH) return REFUSED;
  if (!lines.some((line) => UNDECIDABLE.test(line))) {
    const first = readRoot(block, key);
    if (first) return first;
  }
  const blanked = lines.map(blank);
  if (blanked.some((line) => UNDECIDABLE.test(line))) return REFUSED;
  return readRoot(blanked.join("\n"), key) ?? REFUSED;
}

/** A quoted key's text as YAML decodes it (`"ai_edit"` is ai_edit); null
 * when it won't decode or is longer than any permission key's spelling. */
export function decodeQuotedKey(token: string): string | null {
  if (utf8Length(token) > QUOTED_KEY_MAX_BYTES) return null;
  try {
    const value: unknown = parseYaml(token);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
