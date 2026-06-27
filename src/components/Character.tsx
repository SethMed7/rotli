// The rotli quokka character set — line-art illustrations that appear ONLY in
// the "quokka world" placements: onboarding, empty states, and section/about
// flourishes (never the editor, never notifications — the brand placement law).
// Each vendored SVG is a single `currentColor` path, so the LINE color follows
// the theme (set `color` on the wrapper) while the SHAPE stays constant — exactly
// Seth's rule (2026-06-26). The mark (upper-body quokka) is the in-app logo.

import logoMark from "../assets/characters/_logo.svg?raw";
import aiChat from "../assets/characters/ai_chat.svg?raw";
import base from "../assets/characters/base.svg?raw";
import board from "../assets/characters/excalidraw_board.svg?raw";
import inbox from "../assets/characters/inbox.svg?raw";
import knowledge from "../assets/characters/knowledge_system.svg?raw";
import notes from "../assets/characters/notes.svg?raw";
import staysLocal from "../assets/characters/stays_local.svg?raw";

/** Each character maps to a part of the app (used in that surface's empty state). */
export type CharacterName =
  | "base"
  | "notes"
  | "chat"
  | "inbox"
  | "board"
  | "knowledge"
  | "local";

const SVGS: Record<CharacterName, string> = {
  base,
  notes,
  chat: aiChat,
  inbox,
  board,
  knowledge,
  local: staysLocal,
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
