import { describe, expect, test } from "bun:test";

import type { FrontmatterView } from "../lib/tauri";
import { aiEditBlock, UNREADABLE_PROTECTION } from "./editGate";

const view = (extra: Partial<FrontmatterView>): FrontmatterView => ({
  id: "01GATE",
  created: "",
  updated: "",
  locked: false,
  secure: false,
  localAiAllowed: false,
  pinned: false,
  aiBodyEdit: "allowed",
  fields: [],
  ...extra,
});

describe("aiEditBlock", () => {
  test("an unreadable protection state refuses", () => {
    expect(aiEditBlock(null)).toBe(UNREADABLE_PROTECTION);
  });

  test("locked refuses before anything else", () => {
    expect(aiEditBlock(view({ locked: true, aiBodyEdit: "locked" }))).toMatch(
      /^blocked: this note is locked/,
    );
  });

  test("a person's note and a revoked grant refuse with the menu switch named", () => {
    expect(aiEditBlock(view({ aiBodyEdit: "person-written" }))).toContain("Let AI edit");
    expect(aiEditBlock(view({ aiBodyEdit: "revoked" }))).toContain("turned off");
  });

  test("an AI-made or granted note may be edited", () => {
    expect(aiEditBlock(view({}))).toBeNull();
  });
});
