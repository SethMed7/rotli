// The refusals every chat body edit meets before anything is written, in
// order: an unreadable protection state, LOCKED, then who wrote the note.
// LOCKED binds every model class — "local" buys visibility, never edit
// authority (the maintainer, 2026-08-01) — and a note a person wrote stays
// theirs without a grant (2026-09-29). Rust refuses each again inside
// corpus_write_ai; neither layer trusts the other.

import { bodyEditRefusal } from "../lib/aiEditPolicy";
import type { FrontmatterView } from "../lib/tauri";

export const UNREADABLE_PROTECTION =
  "blocked: this note's protection state couldn't be read, so it can't be edited.";

/** The chat-facing refusal, or null when the edit may proceed. */
export function aiEditBlock(frontmatter: FrontmatterView | null): string | null {
  if (!frontmatter) return UNREADABLE_PROTECTION;
  if (frontmatter.locked) {
    return "blocked: this note is locked — no AI may edit it. The user can unlock it from the note's menu.";
  }
  const refusal = bodyEditRefusal(frontmatter.aiBodyEdit);
  return refusal ? `blocked: ${refusal}` : null;
}
