import { describe, expect, test } from "bun:test";

import { playgroundImportMessage } from "./playgroundImport";

describe("playground import feedback", () => {
  test("distinguishes a fresh import from an existing deletable view", () => {
    expect(playgroundImportMessage({ imported: true, viewName: "Playground", noteCount: 4 })).toBe(
      "Imported 4 lessons into the Playground view.",
    );
    expect(playgroundImportMessage({ imported: false, viewName: "Playground", noteCount: 4 })).toBe(
      "The Playground view is already available.",
    );
  });
});
