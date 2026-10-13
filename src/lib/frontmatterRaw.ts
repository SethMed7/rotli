// Raw-metadata codec twin of corpus.rs merge_raw_frontmatter. This surface
// preserves the user's layout; normal note writes use composeNoteDocument.
import { parseNoteDocument } from "./frontmatter";

export const RAW_IMMUTABLE_KEYS = [
  "id",
  "created",
  "owner",
  "local_ai_allowed",
  "view_tag",
  "created_by",
  "ai_edit",
] as const;

export function rawFrontmatterBlock(text: string): string {
  const parsed = parseNoteDocument(text);
  return parsed.frontmatter ? text.slice(0, text.length - parsed.body.length) : "";
}

/** Add or remove only the secure lines, keeping every other byte (the Rust
 * `with_secure_line_only` twin). No Rotli fields are minted; a fence is added
 * only to hold `secure: true`, and a fence left empty by removal goes. Used in
 * a folder opened in place, where Rotli changes nothing it wasn't asked to. */
export function withSecureLineOnly(text: string, secure: boolean): string {
  const block = rawFrontmatterBlock(text);
  const body = text.slice(block.length);
  const nl = block.includes("\r\n") || (!block && text.includes("\r\n")) ? "\r\n" : "\n";
  const lines = block
    ? block
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
        .slice(1, -1)
    : [];
  // top-level keys only, untrimmed — an indented line belongs to a nested map
  const isKey = (line: string, key: string) => line.includes(":") && line.slice(0, line.indexOf(":")) === key;
  const kept = lines.filter(
    (line) =>
      !isKey(line, "secure") &&
      (secure || (!isKey(line, "local_ai_allowed") && !isKey(line, "secure_origin"))),
  );
  if (secure) kept.push("secure: true");
  if (kept.length === 0) return body;
  return `---${nl}${kept.join(nl)}${nl}---${nl}${body}`;
}

export function mergeRawFrontmatter(original: string, submitted: string): string {
  const block = rawFrontmatterBlock(original);
  const orig = block ? block.trimEnd().split(/\r?\n/).slice(1, -1) : [];
  const lines = submitted.split(/\r?\n/);
  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();
  if (lines[0]?.trim() === "---") {
    lines.shift();
    if (lines.at(-1)?.trim() === "---") lines.pop();
  }
  if (lines.some((line) => line.trim() === "---"))
    throw new Error("the metadata block can't contain a bare --- line");
  for (const key of RAW_IMMUTABLE_KEYS) {
    const isKey = (line: string) => line.slice(0, line.indexOf(":")) === key;
    const before = orig.filter(isKey);
    const after = lines.filter(isKey);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(`\`${key}\` is managed by Rotli, not editable here`);
  }
  const body = parseNoteDocument(original).body;
  return lines.length ? `---\n${lines.join("\n")}\n---\n${body}` : body;
}
