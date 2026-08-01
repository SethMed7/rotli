import { describe, expect, test } from "bun:test";

import { matchesSyntaxName } from "./syntax-contract.mjs";

describe("syntax naming contract", () => {
  test("accepts the convention owned by each source tree", () => {
    expect(matchesSyntaxName("chatMemory", "camelCase")).toBe(true);
    expect(matchesSyntaxName("main-new-note", "kebabCase")).toBe(true);
    expect(matchesSyntaxName("parity_tests", "snakeCase")).toBe(true);
  });

  test("rejects names from a competing tree convention", () => {
    expect(matchesSyntaxName("chat-memory", "camelCase")).toBe(false);
    expect(matchesSyntaxName("mainNewNote", "kebabCase")).toBe(false);
    expect(matchesSyntaxName("parityTests", "snakeCase")).toBe(false);
  });
});
