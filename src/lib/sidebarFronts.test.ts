import { describe, expect, test } from "bun:test";

import {
  isHomeFront,
  DEFAULT_FRONTS,
  type Front,
  canTurnOff,
  enabledFronts,
  frontOf,
  frontState,
  homeFront,
  parseFronts,
  withFront,
} from "./sidebarFronts";

const ALL: readonly Front[] = ["notes", "chat", "breve"];

describe("sidebar fronts", () => {
  test("read tolerantly: Notes is home and everything is on by default", () => {
    for (const value of [undefined, null, 3, "x", [], {}]) expect(parseFronts(value)).toEqual(DEFAULT_FRONTS);
    expect(parseFronts({ off: ["chat", "chat", "bogus"], home: "breve" })).toEqual({
      off: ["chat"],
      home: "breve",
    });
    expect(parseFronts({ off: "chat", home: "elsewhere" })).toEqual(DEFAULT_FRONTS);
  });

  test("at least one front stays on; the last one can't be turned off", () => {
    let prefs = withFront(DEFAULT_FRONTS, "chat", false, ALL);
    prefs = withFront(prefs, "breve", false, ALL);
    expect(enabledFronts(prefs, ALL)).toEqual(["notes"]);
    expect(canTurnOff("notes", prefs, ALL)).toBe(false);
    expect(withFront(prefs, "notes", false, ALL)).toBe(prefs);
    // a hand-edited file with everything off still shows the first front
    expect(enabledFronts({ off: ["notes", "chat", "breve"], home: "notes" }, ALL)).toEqual(["notes"]);
  });

  test("Notes can go off too, and home moves to a front that's on", () => {
    const noNotes = withFront(DEFAULT_FRONTS, "notes", false, ALL);
    expect(enabledFronts(noNotes, ALL)).toEqual(["chat", "breve"]);
    expect(noNotes.home).toBe("chat");
    expect(homeFront({ off: ["breve"], home: "breve" }, ALL)).toBe("notes");
    expect(homeFront({ off: [], home: "chat" }, ALL)).toBe("chat");
  });

  test("a build without Breve never offers it", () => {
    const noBreve: readonly Front[] = ["notes", "chat"];
    expect(enabledFronts(DEFAULT_FRONTS, noBreve)).toEqual(["notes", "chat"]);
    expect(homeFront({ off: [], home: "breve" }, noBreve)).toBe("notes");
  });

  test("a front maps to the sidebar's mode and view, and back", () => {
    for (const front of ALL) {
      const { sidebarMode, sidebarView } = frontState(front);
      expect(frontOf(sidebarMode, sidebarView)).toBe(front);
    }
  });
});

test("whichever front is home is the home front (the switch calls it Home)", () => {
  const all = ["notes", "chat", "breve"] as const;
  expect(isHomeFront("notes", DEFAULT_FRONTS, all)).toBe(true);
  expect(isHomeFront("chat", { off: [], home: "chat" }, all)).toBe(true);
  // a home that's turned off hands home to the first front still on
  expect(isHomeFront("notes", { off: ["chat"], home: "chat" }, all)).toBe(true);
});
