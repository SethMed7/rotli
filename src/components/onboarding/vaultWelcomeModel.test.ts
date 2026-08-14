import { describe, expect, test } from "bun:test";

import { firstNoteBody, normalizeFirstNoteTitle } from "./vaultWelcomeModel";

describe("temporary vault welcome", () => {
  test("creates no note body until the user supplies a real title", () => {
    expect(firstNoteBody("   ")).toBe("");
  });

  test("normalizes a named first note into ordinary Markdown", () => {
    expect(normalizeFirstNoteTitle("  Project\n  north star ")).toBe("Project north star");
    expect(firstNoteBody("  Project\n  north star ")).toBe("# Project north star\n\n");
  });
});
