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

  test("sorts strongest matches within a section and keeps equal scores stable", () => {
    expect(
      rankSearchGroups([
        { name: "body", score: 40 },
        { name: "exact", score: 0 },
        { name: "prefix-a", score: 10 },
        { name: "prefix-b", score: 10 },
      ]).map((row) => row.name),
    ).toEqual(["exact", "prefix-a", "prefix-b", "body"]);
  });
});
