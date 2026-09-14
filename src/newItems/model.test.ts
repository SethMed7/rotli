import { describe, expect, test } from "bun:test";

import {
  DEFAULT_NEW_ITEM_KIND,
  NEW_ITEM_DEFINITIONS,
  NEW_ITEM_KINDS,
  availableNewItems,
  availableNewTabDefault,
  isNewItemAvailable,
  isNewItemKind,
  newItemChoices,
  newItemDefinition,
} from "./model";

describe("new item registry", () => {
  test("has one definition per kind and defaults ⌘T to Markdown", () => {
    expect(DEFAULT_NEW_ITEM_KIND).toBe("markdown");
    expect(NEW_ITEM_DEFINITIONS.map((item) => item.kind)).toEqual([...NEW_ITEM_KINDS]);
    expect(new Set(NEW_ITEM_DEFINITIONS.map((item) => item.label)).size).toBe(NEW_ITEM_KINDS.length);
  });

  test("persisted values validate and unknown kinds resolve safely", () => {
    expect(isNewItemKind("sheet")).toBe(true);
    expect(isNewItemKind("database")).toBe(false);
    expect(newItemDefinition("document").label).toBe("Document");
  });
});

describe("launch availability", () => {
  const stable = { sheets: false, mermaidDiagrams: false };
  const dev = { sheets: true, mermaidDiagrams: true };

  test("stable keeps Sheet and Mermaid diagram in the chooser as coming soon", () => {
    expect(newItemChoices(stable).map((item) => [item.kind, item.availability])).toEqual([
      ["markdown", "available"],
      ["document", "available"],
      ["sheet", "comingSoon"],
      ["board", "available"],
      ["mermaid", "comingSoon"],
    ]);
    expect(newItemChoices(dev).every((item) => item.availability === "available")).toBe(true);
  });

  test("menus and Settings list only creatable kinds", () => {
    expect(availableNewItems(stable).map((item) => item.kind)).toEqual(["markdown", "document", "board"]);
    expect(availableNewItems(dev).map((item) => item.kind)).toEqual([...NEW_ITEM_KINDS]);
  });

  test("a persisted default naming a withheld kind falls back to Markdown", () => {
    expect(availableNewTabDefault("sheet", stable)).toBe("markdown");
    expect(availableNewTabDefault("mermaid", stable)).toBe("markdown");
    expect(availableNewTabDefault("board", stable)).toBe("board");
    expect(availableNewTabDefault("sheet", dev)).toBe("sheet");
    expect(isNewItemAvailable("sheet", { sheets: false, mermaidDiagrams: true })).toBe(false);
  });
});
