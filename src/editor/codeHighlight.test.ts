import { describe, expect, test } from "bun:test";

import { normalizeFenceLang } from "./codeLangs";

describe("code fence language normalization", () => {
  test("aliases resolve to their registered language", () => {
    expect(normalizeFenceLang("ts")).toBe("typescript");
    expect(normalizeFenceLang("TSX")).toBe("typescript");
    expect(normalizeFenceLang("js")).toBe("javascript");
    expect(normalizeFenceLang("jsonc")).toBe("json");
    expect(normalizeFenceLang("py")).toBe("python");
    expect(normalizeFenceLang("sh")).toBe("bash");
    expect(normalizeFenceLang("yml")).toBe("yaml");
    expect(normalizeFenceLang("rs")).toBe("rust");
  });

  test("registered names pass through; unknown and empty stay plain", () => {
    expect(normalizeFenceLang("rust")).toBe("rust");
    expect(normalizeFenceLang("swift")).toBe("swift");
    expect(normalizeFenceLang("")).toBeNull();
    expect(normalizeFenceLang("  ")).toBeNull();
    expect(normalizeFenceLang("brainfuck")).toBeNull();
    // target langs never reach the highlighter, but a stray name is still null
    expect(normalizeFenceLang("mermaid")).toBeNull();
  });
});
