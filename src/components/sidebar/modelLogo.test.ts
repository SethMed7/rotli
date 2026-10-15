// Vendor marks keep the vendor's own colors (the owner, 2026-10-15): every
// mark is its own file, never a mask in Rotli ink, and only OpenAI — whose
// Blossom ships in black and white — changes file between light and dark.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { ChatLogoKey } from "./chatMark";
import { modelLogoSrc } from "./modelLogo";

const KEYS: ChatLogoKey[] = [
  "anthropic",
  "openai",
  "gemini",
  "gemma",
  "qwen",
  "meta",
  "microsoft",
  "mistral",
];

test("every vendor mark renders from a file, in light and dark", () => {
  for (const key of KEYS) {
    expect(modelLogoSrc(key, false)).toBeTruthy();
    expect(modelLogoSrc(key, true)).toBeTruthy();
  }
});

test("only OpenAI swaps artwork between light and dark environments", () => {
  expect(modelLogoSrc("openai", false)).not.toBe(modelLogoSrc("openai", true));
  for (const key of KEYS.filter((k) => k !== "openai")) {
    expect(modelLogoSrc(key, false)).toBe(modelLogoSrc(key, true));
  }
});

test("the shipped marks carry their own color, not currentColor", () => {
  for (const name of ["meta", "microsoft", "mistral", "openai-blossom", "openai-blossom-white"]) {
    const svg = readFileSync(new URL(`../../brand/providers/${name}.svg`, import.meta.url), "utf8");
    expect(svg).not.toContain("currentColor");
  }
});
