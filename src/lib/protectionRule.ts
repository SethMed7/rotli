// A note's protection and the one rule a rewrite obeys: protection may tighten,
// never loosen. The TypeScript twin of src-tauri/src/note_protection.rs
// (review 2026-11-20: re-saves dropped `locked`, `secure` and a chat's
// `secureContext`). Each flag is read the same way on both sides of a
// rewrite, so an unchanged line always passes. Pure: text in, verdict out.

import { bodyEdit, field } from "./aiEditPolicy";
import { parseNoteDocument } from "./frontmatter";
import { frontmatterBlock, protectionMark, withFrontmatterBlock } from "./frontmatterBlock";
import { localAiAllowedOverride } from "./frontmatterKeys";

export interface Protection {
  locked: boolean;
  secure: boolean;
  secureContext: boolean;
  /** `local_ai_allowed`: 0 denied, 1 follows the vault, 2 granted. */
  localAi: 0 | 1 | 2;
  aiBodyEdit: boolean;
}

export function protection(text: string): Protection {
  const foreign = parseNoteDocument(text).frontmatter?.foreign ?? [];
  const local = localAiAllowedOverride(foreign);
  return {
    locked: foreign.some((line) => field(line, "locked") === "true"),
    // Rust's secure_field: only a literal `false` opens the ordinary lane
    secure: foreign.some((line) => {
      const value = field(line, "secure");
      return value !== null && value !== "false";
    }),
    secureContext: protectionMark(text, "secureContext"),
    localAi: local === false ? 0 : local === null ? 1 : 2,
    aiBodyEdit: bodyEdit(foreign) === "allowed",
  };
}

/** The protections `next` gives up that `old` had, by key. */
export function loosened(old: string, next: string): string[] {
  const a = protection(old);
  const b = protection(next);
  const out: string[] = [];
  if (a.locked && !b.locked) out.push("locked");
  if (a.secure && !b.secure) out.push("secure");
  if (a.secureContext && !b.secureContext) out.push("secureContext");
  if (b.localAi > a.localAi) out.push("local_ai_allowed");
  if (b.aiBodyEdit && !a.aiBodyEdit) out.push("ai_edit");
  return out;
}

/** Throw when rewriting `old` (`""` for a new file) as `next` loosens it. */
export function requireNotLooser(old: string, next: string): void {
  const keys = loosened(old, next);
  if (keys.length)
    throw new Error(
      `refused: this write would remove the note's protection (${keys.join(", ")}); change it from the note's own controls`,
    );
}

/** `contents` with `key: true` in its first frontmatter block, replacing any
 * `key:` line, or in a new block when it has none. */
function withMark(contents: string, key: string): string {
  const block = frontmatterBlock(contents);
  if (!block) return `---\n${key}: true\n---\n\n${contents}`;
  const lines = block.inner.split("\n");
  const at = lines.findIndex((line) => field(line, key) !== null);
  if (at >= 0) lines[at] = `${key}: true`;
  else lines.push(`${key}: true`);
  return withFrontmatterBlock(contents, block, lines.join("\n"));
}

/** `next` with every on/off protection `old` had put back: what a chat
 * rewrite does, so a re-save can only tighten. */
export function keepProtection(old: string, next: string): string {
  const had = protection(old);
  let out = next;
  if (had.secureContext && !protection(out).secureContext) out = withMark(out, "secureContext");
  if (had.secure && !protection(out).secure) out = withMark(out, "secure");
  if (had.locked && !protection(out).locked) out = withMark(out, "locked");
  return out;
}

/** A note or a board: the files whose own text carries protection. */
export function isNotePath(path: string): boolean {
  return /\.(md|excalidraw)$/i.test(path);
}
