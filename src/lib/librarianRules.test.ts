import { describe, expect, test } from "bun:test";

import {
  DEFAULT_LIBRARIAN_RULES,
  parseLibrarianRules,
  peopleAreas,
  secureByName,
  validGroup,
} from "./librarianRules";

describe("the Librarian rules", () => {
  test("missing or malformed rules are the defaults", () => {
    for (const value of [undefined, null, 3, "x", []]) {
      expect(parseLibrarianRules(value)).toEqual(DEFAULT_LIBRARIAN_RULES);
    }
    expect(DEFAULT_LIBRARIAN_RULES.people).toEqual({
      mode: "groups",
      groups: ["Family", "Friends", "Work", "Acquaintances"],
    });
  });

  test("rules are trimmed, deduplicated, capped and safe", () => {
    const rules = parseLibrarianRules({
      secureKeywords: [" Passport ", "passport", "", 7, "x"],
      people: { mode: "groups", groups: ["Family", "../etc", "_hidden", "Choir", "a/b", "family"] },
      filing: ["Recipes go to Cooking", "  "],
    });
    expect(rules).toEqual({
      secureKeywords: ["Passport", "x"],
      people: { mode: "groups", groups: ["Family", "Choir"] },
      filing: ["Recipes go to Cooking"],
    });
    expect(
      parseLibrarianRules({ secureKeywords: Array.from({ length: 80 }, (_, i) => `w${i}`) }).secureKeywords,
    ).toHaveLength(50);
  });

  test("a group is one plain folder name", () => {
    expect(validGroup("Choir")).toBe(true);
    for (const bad of ["", "  ", "a/b", "a\\\\b", "..", "_x", ".x", "x".repeat(41)])
      expect(validGroup(bad)).toBe(false);
  });

  test("People areas follow the mode, and the groups survive a switch to simple", () => {
    const groups = parseLibrarianRules({ people: { mode: "groups", groups: ["Family", "Friends"] } });
    expect(peopleAreas(groups)).toEqual(["People/Family", "People/Friends"]);
    const simple = parseLibrarianRules({ people: { mode: "simple", groups: ["Family", "Friends"] } });
    expect(peopleAreas(simple)).toEqual(["People"]);
    expect(simple.people.groups).toEqual(["Family", "Friends"]);
    expect(peopleAreas(parseLibrarianRules({ people: { groups: [] } }))).toEqual(["People"]);
  });

  test("secure keywords match whole words of the name, never the folder", () => {
    // the full case table is shared with Rust in scripts/fixtures/parity.json
    expect(secureByName("Passport scan", "wiki/x.md", ["passport"])).toBe(true);
    expect(secureByName("Passports of the world", "wiki/y.md", ["passport"])).toBe(false);
    expect(secureByName("Travel", "wiki/passport/travel.md", ["passport"])).toBe(false);
  });
});
