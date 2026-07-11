import { describe, expect, test } from "bun:test";
import { buildModelMap, modelMapPolicy, priorityOrder, type ModelMapNote } from "./modelMap";

const note = (id: string, updatedAt: number, pinned = false): ModelMapNote => ({
  id,
  title: id,
  folderId: "wiki/projects",
  updatedAt,
  pinned,
  kind: "note",
});

describe("Model Mapping 0", () => {
  test("chooses a map shape from capability instead of provider-specific branching", () => {
    expect(modelMapPolicy(8_000).profile).toBe("compact");
    expect(modelMapPolicy(64_000).profile).toBe("balanced");
    expect(modelMapPolicy(200_000).profile).toBe("expansive");
  });

  test("learnable explicit signals order pinned work before recency", () => {
    const ordered = [note("old-pinned", 1, true), note("new", 10)].sort(priorityOrder);
    expect(ordered.map((item) => item.id)).toEqual(["old-pinned", "new"]);
  });

  test("small models receive a bounded map while frontier models receive ids", () => {
    const notes = [note("older", 1), note("newer", 2), note("pinned", 0, true)];
    const compact = buildModelMap(notes, 8_000, 240);
    const expansive = buildModelMap(notes, 200_000, 2000);
    expect(compact).toContain("Model Map 0 · compact");
    expect(compact).not.toContain("{id:");
    expect(expansive).toContain("{id: pinned}");
  });
});
