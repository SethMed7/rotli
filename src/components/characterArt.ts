// The eleven full-size quokka poses, ?raw so the line art stays inline SVG
// (currentColor tinting — a ?url <img> would break the theme-follows-color
// rule). This module is loaded ONLY via dynamic import from character.tsx:
// ~450 KB of markup was 29% of the entry chunk (perf audit 2026-07-30, #6),
// and every placement is a low-frequency quokka-world moment that can afford
// one async tick. The compact logo mark stays eager in character.tsx.

// The type lives HERE (not character.tsx) so the dependency stays one-way:
// character.tsx imports this module (type-only statically, erased at build;
// the art itself only via dynamic import) — never the other way around.

import aiChat from "../assets/characters/ai_chat.svg?raw";
import base from "../assets/characters/base.svg?raw";
import board from "../assets/characters/excalidraw_board.svg?raw";
import celebrating from "../assets/characters/celebrating.svg?raw";
import inbox from "../assets/characters/inbox.svg?raw";
import knowledge from "../assets/characters/knowledge_system.svg?raw";
import notes from "../assets/characters/notes.svg?raw";
import rest from "../assets/characters/rest.svg?raw";
import searching from "../assets/characters/searching.svg?raw";
import staysLocal from "../assets/characters/stays_local.svg?raw";
import waving from "../assets/characters/waving.svg?raw";

/** Each character maps to a part of the app (used in that surface's empty state). */
export type CharacterName =
  | "base"
  | "notes"
  | "chat"
  | "inbox"
  | "board"
  | "knowledge"
  | "local"
  | "rest"
  | "waving"
  | "searching"
  | "celebrating";

export const SVGS: Record<CharacterName, string> = {
  base,
  notes,
  chat: aiChat,
  inbox,
  board,
  knowledge,
  local: staysLocal,
  rest,
  waving,
  searching,
  celebrating,
};
