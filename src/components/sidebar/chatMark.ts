// The mark on the left of a chat row (Seth, 2026-08-04: "the little chat icon
// on the left isn't needed… because all are chats, so having it doesn't make
// sense anymore — do like the model logo or something else to make this more
// intuitive and usable").
//
// A glyph that says "this is a chat", inside a list of nothing but chats, is a
// column of wasted pixels. The slot is worth more as the answer to the question
// you actually have while scanning: WHO is answering. So it now carries the
// chat's model — its vendor, as a tinted monogram.
//
// A LETTER, NOT A LOGO: rotli doesn't reproduce anyone's trademark. A vendor
// initial in the vendor's colour groups the list at a glance without pretending
// to be someone's brand asset, and it stays legible at 14px where a real logo
// would turn to mush.
//
// Pure: no React, no store.

/** The vendor lanes a chat can run on, plus the on-device one. */
export type ChatMarkKey = "anthropic" | "openai" | "google" | "local" | "preset";

export interface ChatMark {
  key: ChatMarkKey;
  /** The single character drawn in the badge. */
  initial: string;
  /** Hover text — the full sentence the badge is shorthand for. */
  title: string;
}

const MARKS: Record<ChatMarkKey, { initial: string; vendor: string }> = {
  anthropic: { initial: "A", vendor: "Anthropic" },
  openai: { initial: "O", vendor: "OpenAI" },
  google: { initial: "G", vendor: "Google" },
  local: { initial: "L", vendor: "this Mac" },
  preset: { initial: "H", vendor: "a hybrid preset" },
};

/**
 * Which vendor a chat's model belongs to.
 *
 * `provider` is the lane the model came from — the ids in src/ai/models.ts.
 * Anything unrecognized reads as local: a model rotli can't place is one the
 * user installed, and calling it on-device is the answer that can't leak.
 */
export function markKeyOf(provider: string | undefined): ChatMarkKey {
  switch (provider) {
    case "claude":
      return "anthropic";
    case "codex":
      return "openai";
    case "agy":
    case "gemini":
      return "google";
    case "preset":
      return "preset";
    default:
      return "local";
  }
}

export function chatMark(provider: string | undefined, modelName: string): ChatMark {
  const key = markKeyOf(provider);
  const { initial, vendor } = MARKS[key];
  return { key, initial, title: `${modelName} — ${vendor}` };
}
