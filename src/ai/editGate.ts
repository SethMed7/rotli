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

/** The person's answer when the chat asks to edit a note they wrote. */
export type EditAnswer = "once" | "always" | "no";

export interface EditRequest {
  id: string;
  title: string;
  /** They turned AI editing off for this note before: only "always" (turning
   * it back on) or "no" can answer; "Allow once" never overrides a no. */
  revoked: boolean;
}

export const KEPT_AS_IS =
  "blocked: the person chose to keep this note as it is. Put your version in a new note with create_note, and tell them where it is.";

/** Like a code editor asking before it writes (the owner, 2026-10-15): a note
 * the person wrote, or one they turned AI editing off for, asks them first
 * instead of quietly refusing. A lock never asks; Rust re-checks everything. */
export async function askToEdit(
  frontmatter: FrontmatterView | null,
  request: Omit<EditRequest, "revoked">,
  ask: ((request: EditRequest) => Promise<EditAnswer>) | undefined,
  grant: (id: string) => Promise<void>,
): Promise<{ block: string | null; consented: boolean }> {
  const block = aiEditBlock(frontmatter);
  const verdict = frontmatter?.aiBodyEdit;
  const askable = !frontmatter?.locked && (verdict === "person-written" || verdict === "revoked");
  if (!block || !askable || !ask) return { block, consented: false };
  const answer = await ask({ ...request, revoked: verdict === "revoked" });
  if (answer === "always") {
    await grant(request.id);
    return { block: null, consented: false };
  }
  if (answer === "once" && verdict === "person-written") return { block: null, consented: true };
  return { block: KEPT_AS_IS, consented: false };
}
