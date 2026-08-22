// Full-size quokka art is loaded only through character.tsx's dynamic import.
// Canonical poses keep their original inline SVG line work plus a generated
// interior mask. Approved new expressions are split into body, line, and detail
// layers. Accessories use hue-owned fill and ink-owned line masks, with no
// preserved source color that could escape those choices.

import bucketHatColor from "../assets/characters/accessories/bucket-hat-color.svg?url";
import bucketHatInk from "../assets/characters/accessories/bucket-hat-ink.svg?url";
import bucketHatSideColor from "../assets/characters/accessories/bucket-hat-side-color.svg?url";
import bucketHatSideInk from "../assets/characters/accessories/bucket-hat-side-ink.svg?url";
import bucketHatThreeQuarterColor from "../assets/characters/accessories/bucket-hat-three-quarter-color.svg?url";
import bucketHatThreeQuarterInk from "../assets/characters/accessories/bucket-hat-three-quarter-ink.svg?url";
import aiChat from "../assets/characters/ai_chat.svg?raw";
import base from "../assets/characters/base.svg?raw";
import celebrating from "../assets/characters/celebrating.svg?raw";
import attentionBody from "../assets/characters/concepts/layers/attention-body.webp?url";
import attentionDetail from "../assets/characters/concepts/layers/attention-detail.webp?url";
import attentionLine from "../assets/characters/concepts/layers/attention-line.webp?url";
import glassesAccessoryInk from "../assets/characters/concepts/layers/glasses-accessory-ink.webp?url";
import glassesAccessory from "../assets/characters/concepts/layers/glasses-accessory.webp?url";
import gogglesAccessoryInk from "../assets/characters/concepts/layers/goggles-accessory-ink.webp?url";
import gogglesAccessory from "../assets/characters/concepts/layers/goggles-accessory.webp?url";
import listeningBody from "../assets/characters/concepts/layers/listening-body.webp?url";
import listeningDetail from "../assets/characters/concepts/layers/listening-detail.webp?url";
import listeningLine from "../assets/characters/concepts/layers/listening-line.webp?url";
import thoughtfulBody from "../assets/characters/concepts/layers/thoughtful-body.webp?url";
import thoughtfulDetail from "../assets/characters/concepts/layers/thoughtful-detail.webp?url";
import thoughtfulLine from "../assets/characters/concepts/layers/thoughtful-line.webp?url";
import walkingBody from "../assets/characters/concepts/layers/walking-body.webp?url";
import walkingDetail from "../assets/characters/concepts/layers/walking-detail.webp?url";
import walkingLine from "../assets/characters/concepts/layers/walking-line.webp?url";
import board from "../assets/characters/excalidraw_board.svg?raw";
import inbox from "../assets/characters/inbox.svg?raw";
import knowledge from "../assets/characters/knowledge_system.svg?raw";
import aiChatMask from "../assets/characters/masks/ai_chat.webp?url";
import baseMask from "../assets/characters/masks/base.webp?url";
import celebratingMask from "../assets/characters/masks/celebrating.webp?url";
import boardMask from "../assets/characters/masks/excalidraw_board.webp?url";
import inboxMask from "../assets/characters/masks/inbox.webp?url";
import knowledgeMask from "../assets/characters/masks/knowledge_system.webp?url";
import notesMask from "../assets/characters/masks/notes.webp?url";
import restMask from "../assets/characters/masks/rest.webp?url";
import searchingMask from "../assets/characters/masks/searching.webp?url";
import localMask from "../assets/characters/masks/stays_local.webp?url";
import wavingMask from "../assets/characters/masks/waving.webp?url";
import notes from "../assets/characters/notes.svg?raw";
import rest from "../assets/characters/rest.svg?raw";
import searching from "../assets/characters/searching.svg?raw";
import staysLocal from "../assets/characters/stays_local.svg?raw";
import waving from "../assets/characters/waving.svg?raw";
import type { QuokkaPose } from "../brand/quokka";

export type CanonicalCharacterName =
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

export type ConceptCharacterName = "thoughtful" | "walking" | "listening" | "attention";

export type CharacterName = QuokkaPose;

export type LayeredCharacterName = ConceptCharacterName;

export interface LayeredCharacterArt {
  body: string;
  line: string;
  detail: string;
}

export type AccessoryCharacterName = "glasses" | "bucket-hat" | "goggles";

export interface AccessoryCharacterArt {
  color: string;
  ink: string;
}

export interface AccessoryCharacterArtSet extends AccessoryCharacterArt {
  /** Per-pose override; null means the accessory has no credible art for
   * that pose (front-only eyewear on a profile head) and stays off it. */
  poses?: Partial<Record<CharacterName, AccessoryCharacterArt | null>>;
  /** The glasses' color layer is pure accent shapes (bridge, hinges, rim
   * dashes) that must sit ON the ink frames; drawing them under the ink
   * buries them into ragged slivers. */
  colorOverInk?: boolean;
}

export const SVGS: Record<CanonicalCharacterName, string> = {
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

export const MASKS: Record<CanonicalCharacterName, string> = {
  base: baseMask,
  notes: notesMask,
  chat: aiChatMask,
  inbox: inboxMask,
  board: boardMask,
  knowledge: knowledgeMask,
  local: localMask,
  rest: restMask,
  waving: wavingMask,
  searching: searchingMask,
  celebrating: celebratingMask,
};

export const LAYERED_ART: Record<LayeredCharacterName, LayeredCharacterArt> = {
  thoughtful: { body: thoughtfulBody, line: thoughtfulLine, detail: thoughtfulDetail },
  walking: { body: walkingBody, line: walkingLine, detail: walkingDetail },
  listening: { body: listeningBody, line: listeningLine, detail: listeningDetail },
  attention: { body: attentionBody, line: attentionLine, detail: attentionDetail },
};

export const ACCESSORY_ART: Record<AccessoryCharacterName, AccessoryCharacterArtSet> = {
  glasses: { color: glassesAccessory, ink: glassesAccessoryInk, colorOverInk: true },
  "bucket-hat": {
    color: bucketHatColor,
    ink: bucketHatInk,
    poses: {
      thoughtful: { color: bucketHatThreeQuarterColor, ink: bucketHatThreeQuarterInk },
      listening: { color: bucketHatThreeQuarterColor, ink: bucketHatThreeQuarterInk },
      walking: { color: bucketHatSideColor, ink: bucketHatSideInk },
    },
  },
  goggles: { color: gogglesAccessory, ink: gogglesAccessoryInk },
};

export function isCanonicalCharacter(name: CharacterName): name is CanonicalCharacterName {
  return name in SVGS;
}
