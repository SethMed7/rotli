import { describe, expect, test } from "bun:test";

import { paletteMatchScore, rankSearchGroups } from "./paletteModel";

describe("palette relevance", () => {
  test("exact and prefix filename matches outrank body-only note hits", () => {
    expect(paletteMatchScore("tanstack-ar", "tanstack-architecture.docx", "")).toBeLessThan(
      paletteMatchScore("tanstack-ar", "Research notes", "mentions tanstack architecture"),
    );
    expect(
      rankSearchGroups([
        { name: "Notes", score: 40 },
        { name: "Files", score: 10 },
        { name: "Chats", score: 30 },
      ]).map((group) => group.name),
    ).toEqual(["Files", "Chats", "Notes"]);
  });
});
