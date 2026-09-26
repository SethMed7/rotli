import { describe, expect, test } from "bun:test";

import { isPlaceholderAlias, isTitleTypingTrail } from "./aliases";

describe("rename alias rules (twins of corpus.rs)", () => {
  test("a fresh note's placeholder name is never an alias", () => {
    for (const value of ["Untitled", "untitled", " untitled (7) ", "UNTITLED (12)"]) {
      expect(isPlaceholderAlias(value)).toBe(true);
    }
    for (const value of ["Untitled plan", "untitled ()", "untitled (x)", "my untitled", ""]) {
      expect(isPlaceholderAlias(value)).toBe(false);
    }
  });

  test("a title that extends or trims the other is the typing trail", () => {
    expect(isTitleTypingTrail("Garden", "Garden beds")).toBe(true);
    expect(isTitleTypingTrail("Garden beds -", "garden beds")).toBe(true);
    expect(isTitleTypingTrail("Garden beds", "Budget")).toBe(false);
    expect(isTitleTypingTrail("", "Budget")).toBe(false);
  });
});
