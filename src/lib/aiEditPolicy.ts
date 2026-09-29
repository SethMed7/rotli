// Who may rewrite a note's BODY on an AI lane — the TypeScript twin of
// src-tauri/src/ai_edit_policy.rs (pinned by scripts/fixtures/parity.json).
// Rust decides for the desktop app; this twin serves Rotli Web and lets the
// chat fail fast with the same answer. Pure: foreign frontmatter lines in, a
// verdict out.
//
// - `created_by`: stamped once when a chat, an agent, or the Librarian creates
//   a note. Absent means a person wrote it.
// - `ai_edit`: the person's per-note grant, set only from the note's menu.
// A locked note refuses every AI; otherwise the grant decides, and with no
// grant only an AI-made note is editable.

export const AI_CREATORS = ["chat", "agent", "librarian"] as const;
export type NoteCreator = (typeof AI_CREATORS)[number];

export type AiBodyEdit = "allowed" | "locked" | "person-written" | "revoked";

/** The value of `key: value` when the line's (trimmed) key is `key`. */
function field(line: string, key: string): string | null {
  const colon = line.indexOf(":");
  if (colon < 0 || line.slice(0, colon).trim() !== key) return null;
  return line.slice(colon + 1).trim();
}

export function bodyEdit(foreign: readonly string[]): AiBodyEdit {
  if (foreign.some((line) => field(line, "locked") === "true")) return "locked";
  const grant = foreign.map((line) => field(line, "ai_edit")).find((value) => value !== null);
  if (grant !== undefined && grant !== null) return grant === "true" ? "allowed" : "revoked";
  const creator = foreign.map((line) => field(line, "created_by")).find((value) => value !== null);
  return creator && (AI_CREATORS as readonly string[]).includes(creator) ? "allowed" : "person-written";
}

/** The refusal a chat sees first; null when the edit may proceed. Rust's
 * seam refuses again in its own words. */
export function bodyEditRefusal(verdict: AiBodyEdit): string | null {
  switch (verdict) {
    case "allowed":
      return null;
    case "locked":
      return "this note is locked, so no AI may change it. The user can unlock it from the note's menu.";
    case "person-written":
      return "the user wrote this note themselves. Its text stays theirs unless they turn on “Let AI edit the text” in the note's menu — offer to put your version in a new note instead.";
    case "revoked":
      return "the user turned off AI editing for this note. Offer to put your version in a new note, or ask them to turn “Let AI edit the text” back on in the note's menu.";
  }
}
