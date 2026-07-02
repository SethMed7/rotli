// The rotli quokka character set — line-art illustrations that appear ONLY in
// the "quokka world" placements: onboarding, empty states, and section/about
// flourishes (never the editor, never notifications — the brand placement law).
// Each vendored SVG is a single `currentColor` path, so the LINE color follows
// the theme (set `color` on the wrapper) while the SHAPE stays constant — exactly
// Seth's rule (2026-06-26). The mark (upper-body quokka) is the in-app logo.

// the bold-body mark: only the body+ears carry a thick stroke (eyes/nose/mouth stay
// crisp), so the lone mark reads clearly at tiny chrome sizes — tray + titlebar
// (Seth, 2026-06-27). The full-size characters keep the plain line weight.
//
// Re-vendored 2026-07-02: the original export's FILENAMES were rotated one pose
// off (base showed the shield, stays_local the easel, …) — each file now carries
// the pose its name claims: base = plain standing · notes = notepad+pencil ·
// ai_chat = laptop+speech bubble · inbox = envelope · excalidraw_board = easel ·
// knowledge_system = files+org tree · stays_local = shield+padlock. Same pass
// doubled the eye-highlight holes (17→34 viewBox units) so the eyes read as eyes
// with a catchlight instead of blobs at empty-state sizes; and a derived `rest`
// pose (closed eyes, same line grammar) joined the set for quiet empty states.
import logoMark from "../assets/characters/_logo-bold.svg?raw";
import aiChat from "../assets/characters/ai_chat.svg?raw";
import base from "../assets/characters/base.svg?raw";
import board from "../assets/characters/excalidraw_board.svg?raw";
import inbox from "../assets/characters/inbox.svg?raw";
import knowledge from "../assets/characters/knowledge_system.svg?raw";
import notes from "../assets/characters/notes.svg?raw";
import rest from "../assets/characters/rest.svg?raw";
import staysLocal from "../assets/characters/stays_local.svg?raw";

/** Each character maps to a part of the app (used in that surface's empty state). */
export type CharacterName =
  | "base"
  | "notes"
  | "chat"
  | "inbox"
  | "board"
  | "knowledge"
  | "local"
  | "rest";

const SVGS: Record<CharacterName, string> = {
  base,
  notes,
  chat: aiChat,
  inbox,
  board,
  knowledge,
  local: staysLocal,
  rest,
};

interface CharacterProps {
  name: CharacterName;
  size?: number;
  className?: string;
}

/** A quokka character illustration. Inherits `color` for its line color (so a
 * parent can tune it per theme/surface); defaults to the surface text color. */
export function Character({ name, size = 120, className }: CharacterProps) {
  return (
    <span
      className={className ? `quokka ${className}` : "quokka"}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: SVGS[name] }}
    />
  );
}

/** The compact rotli mark — the upper-body quokka used as the in-app logo
 * (titlebar identity, about). Same currentColor line so it tints with the theme. */
export function QuokkaMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `quokka-mark ${className}` : "quokka-mark"}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: logoMark }}
    />
  );
}
