// The vendor mark that replaced the chat glyph. The mapping matters because a
// wrong hue is a confident lie about who is answering.

import { describe, expect, test } from "bun:test";

import { chatMark, markKeyOf } from "./chatMark";

describe("markKeyOf", () => {
  test("each connected lane maps to its vendor", () => {
    expect(markKeyOf("claude")).toBe("anthropic");
    expect(markKeyOf("codex")).toBe("openai");
  });

  test("both Google transports share one vendor — agy and the API lane", () => {
    expect(markKeyOf("agy")).toBe("gemini");
    expect(markKeyOf("gemini")).toBe("gemini");
  });

  test("a hybrid preset is its own mark", () => {
    expect(markKeyOf("preset")).toBe("preset");
  });

  test("anything unknown reads as local — the answer that can't leak", () => {
    expect(markKeyOf("mlx")).toBe("local");
    expect(markKeyOf(undefined)).toBe("local");
    expect(markKeyOf("some-model-rotli-never-heard-of")).toBe("local");
  });

  test("local families use their real model marks without changing locality", () => {
    expect(markKeyOf("mlx", "Gemma 3 12B")).toBe("gemma");
    expect(markKeyOf("mlx", "mlx-community/Qwen3-30B-A3B-4bit")).toBe("qwen");
  });
});

describe("chatMark", () => {
  test("the title names the model AND the vendor it belongs to", () => {
    expect(chatMark("codex", "GPT-5.6 Terra").title).toBe("GPT-5.6 Terra — OpenAI");
    expect(chatMark("gemini", "Gemini 3.5 Flash").title).toBe("Gemini 3.5 Flash — Google");
  });

  test("a local model says where it runs, not who made it", () => {
    expect(chatMark("mlx", "Qwen3 30B").title).toBe("Qwen3 30B — this Mac");
  });

  test("known families carry logos; only honest fallbacks carry initials", () => {
    for (const p of ["claude", "codex", "agy", "gemini"]) {
      expect(chatMark(p, "x").logo).toBeDefined();
      expect(chatMark(p, "x").initial).toBeUndefined();
    }
    expect(chatMark("mlx", "Gemma 3").logo).toBe("gemma");
    expect(chatMark("mlx", "Qwen3").logo).toBe("qwen");
    expect(chatMark("mlx", "Unknown local model").initial).toBe("L");
    expect(chatMark("preset", "Hybrid").initial).toBe("H");
  });
});
