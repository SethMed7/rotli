import { describe, expect, test } from "bun:test";

import {
  DEFAULT_NEW_ITEM_KIND,
  NEW_ITEM_DEFINITIONS,
  NEW_ITEM_KINDS,
  isNewItemKind,
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
