// A note's protection and the one rule a rewrite obeys: protection may tighten,
// never loosen. The TypeScript twin of src-tauri/src/note_protection.rs
// (review 2026-11-20: re-saves dropped `locked`, `secure` and a chat's
// `secureContext`). Each flag is read the same way on both sides of a
// rewrite, so an unchanged line always passes. Pure: text in, verdict out.

import { type AiBodyEdit, bodyEdit, field } from "./aiEditPolicy";
import { locksNote, namesLocked, parseNoteDocument, securesNote } from "./frontmatter";
import { frontmatterBlock, protectionMark, withFrontmatterBlock } from "./frontmatterBlock";
import { localAiAllowedOverride } from "./frontmatterKeys";

export interface Protection {
  locked: boolean;
  secure: boolean;
  secureContext: boolean;
  /** `local_ai_allowed`: 0 denied, 1 follows the vault, 2 granted. */
  localAi: 0 | 1 | 2;
  /** Who may edit the body, by `ai_edit` and `created_by` alone (`locked` is
   * its own flag): 0 revoked, 1 person-written, 2 allowed. Revoked is stricter
   * than a person's note: consent to one `/ai` insertion never overrides a
   * deliberate "no". */
  bodyEdit: 0 | 1 | 2;
}

const BODY_RANK: Record<AiBodyEdit, 0 | 1 | 2> = { revoked: 0, locked: 0, "person-written": 1, allowed: 2 };

/** `chat`: a chat's taint stays fail-closed (an unclosed block reads marked),
 * where a note's unclosed `---` is a horizontal rule (self-review of 306). */
export function protection(text: string, chat = false): Protection {
  const foreign = parseNoteDocument(text).frontmatter?.foreign ?? [];
  const local = localAiAllowedOverride(foreign);
  return {
    locked: foreign.some(locksNote),
    secure: foreign.some(securesNote),
    secureContext: protectionMark(text, "secureContext", chat),
    localAi: local === false ? 0 : local === null ? 1 : 2,
    bodyEdit: BODY_RANK[bodyEdit(foreign.filter((line) => !namesLocked(line)))],
  };
}

/** The protections `next` gives up that `old` had, by key. */
export function loosened(old: string, next: string, chat = false): string[] {
  const a = protection(old, chat);
  const b = protection(next, chat);
  const out: string[] = [];
  if (a.locked && !b.locked) out.push("locked");
  if (a.secure && !b.secure) out.push("secure");
  if (a.secureContext && !b.secureContext) out.push("secureContext");
  if (b.localAi > a.localAi) out.push("local_ai_allowed");
  if (b.bodyEdit > a.bodyEdit) out.push("ai_edit");
  return out;
}

/** Throw when rewriting `old` (`""` for a new file) as `next` loosens it. */
export function requireNotLooser(old: string, next: string, chat = false): void {
  const keys = loosened(old, next, chat);
  if (keys.length)
    throw new Error(
      `refused: this write would remove the note's protection (${keys.join(", ")}); change it from the note's own controls`,
    );
}

/** Throw when `next` loosens a key the raw metadata editor may not: the ones
 * only Rust writes and the one-way chat taint (`locked` and `secure` are the
 * person's to type there). Rust's require_owned_not_looser. */
export function requireOwnedNotLooser(old: string, next: string): void {
  const keys = loosened(old, next).filter((key) => key !== "locked" && key !== "secure");
  if (keys.length)
    throw new Error(
      `refused: this would remove the note's ${keys.join(", ")} setting; use the note's own controls`,
    );
}

/** `contents` with `key: value` in its first frontmatter block, replacing any
 * `key:` line, or in a new block when it has none. */
function withLine(contents: string, key: string, value: string): string {
  const block = frontmatterBlock(contents);
  if (!block) return `---\n${key}: ${value}\n---\n\n${contents}`;
  const lines = block.inner.split("\n");
  // an indented line is block text, never the key (self-review of 306)
  const at = lines.findIndex((line) => !/^[ \t]/.test(line) && field(line, key) !== null);
  if (at >= 0) lines[at] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return withFrontmatterBlock(contents, block, lines.join("\n"));
}

const RESTORES: [(had: Protection, now: Protection) => boolean, string, string][] = [
  [(had, now) => had.secureContext && !now.secureContext, "secureContext", "true"],
  [(had, now) => had.secure && !now.secure, "secure", "true"],
  [(had, now) => had.locked && !now.locked, "locked", "true"],
  [(had, now) => had.localAi === 0 && now.localAi !== 0, "local_ai_allowed", "false"],
  [(had, now) => had.bodyEdit === 0 && now.bodyEdit > 0, "ai_edit", "false"],
];

/** `next` with every protection `old` had put back, flags and denials: what
 * a chat rewrite does, so a re-save keeps them. A new grant `old` never had is
 * left for `requireNotLooser` to refuse. */
export function keepProtection(old: string, next: string): string {
  const had = protection(old, true);
  let out = next;
  for (const [lost, key, value] of RESTORES)
    if (lost(had, protection(out, true))) out = withLine(out, key, value);
  return out;
}

/** A note or a board: the files whose own text carries protection. */
export function isNotePath(path: string): boolean {
  // Rust's `Path::extension`: trailing slashes go, and a leading-dot name
  // (`.md`) has no extension (shared fixture, protection-rule.json)
  const name = path.replace(/\/+$/, "").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext === "md" || ext === "excalidraw";
}
