// The mark on the left of a chat row (Seth, 2026-08-04: "the little chat icon
// on the left isn't needed… because all are chats, so having it doesn't make
// sense anymore — do like the model logo or something else to make this more
// intuitive and usable").
//
// A glyph that says "this is a chat", inside a list of nothing but chats, is a
// column of wasted pixels. The slot is worth more as the answer to the question
// you actually have while scanning: WHO is answering. So it now carries the
// chat's model — its vendor/model-family mark.
//
// Authentic compact marks are clearer than invented initials. Connected lanes
// map from provider; local MLX models map from their family name so Gemma and
// Qwen remain distinguishable without misrepresenting an unknown local model.
//
// Pure: no React, no store.

/** The vendor lanes a chat can run on, plus the on-device one. */
export type ChatLogoKey =
  | "anthropic"
  | "openai"
  | "gemini"
  | "gemma"
  | "qwen"
  | "meta"
  | "microsoft"
  | "mistral";
export type ChatMarkKey = ChatLogoKey | "local" | "preset";

export interface ChatMark {
  key: ChatMarkKey;
  /** Authentic model-family artwork; absent only for honest fallbacks. */
  logo?: ChatLogoKey;
  /** The fallback character for presets and unknown local models. */
  initial?: string;
  /** Hover text — the full sentence the badge is shorthand for. */
  title: string;
}

const MARKS: Record<ChatMarkKey, { initial?: string; logo?: ChatLogoKey; vendor: string }> = {
  anthropic: { logo: "anthropic", vendor: "Anthropic" },
  openai: { logo: "openai", vendor: "OpenAI" },
  gemini: { logo: "gemini", vendor: "Google" },
  gemma: { logo: "gemma", vendor: "this Mac" },
  qwen: { logo: "qwen", vendor: "this Mac" },
  meta: { logo: "meta", vendor: "this Mac" },
  microsoft: { logo: "microsoft", vendor: "this Mac" },
  mistral: { logo: "mistral", vendor: "this Mac" },
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
export function markKeyOf(provider: string | undefined, modelName = ""): ChatMarkKey {
  switch (provider) {
    case "claude":
      return "anthropic";
    case "codex":
      return "openai";
    case "agy":
    case "gemini":
      return "gemini";
    case "preset":
      return "preset";
    default: {
      const family = modelName.toLowerCase();
      if (family.includes("gemma")) return "gemma";
      if (family.includes("qwen")) return "qwen";
      if (family.includes("llama")) return "meta";
      if (family.includes("phi")) return "microsoft";
      if (family.includes("mistral") || family.includes("ministral")) return "mistral";
      return "local";
    }
  }
}

export function chatMark(provider: string | undefined, modelName: string): ChatMark {
  const key = markKeyOf(provider, modelName);
  const { initial, logo, vendor } = MARKS[key];
  return {
    key,
    title: `${modelName} — ${vendor}`,
    ...(initial ? { initial } : {}),
    ...(logo ? { logo } : {}),
  };
}
