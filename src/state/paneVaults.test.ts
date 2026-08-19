import { describe, expect, test } from "bun:test";

import { canOpenVaultInPanes, contentVaultId } from "./paneVaults";

describe("pane vault identity", () => {
  test("maps bare content to the corpus and preserves linked-root ids", () => {
    expect(contentVaultId("wiki/note.md")).toBe("corpus");
    expect(contentVaultId("project-two:wiki/note.md")).toBe("project-two");
  });

  test("allows only the active corpus route", () => {
    expect(canOpenVaultInPanes("corpus")).toBe(true);
    expect(canOpenVaultInPanes("project-two")).toBe(false);
  });
});
