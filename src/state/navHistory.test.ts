// Pure-reducer tests for the Back/Forward trail (#14). The store's suppress
// flag + side effects are trivial wrappers; the branching logic lives in these
// pure functions, so this is where the coverage belongs.

import { describe, expect, test } from "bun:test";

import {
  EMPTY_NAV,
  NAV_CAP,
  type NavState,
  backId,
  canBack,
  canForward,
  dropNav,
  forwardId,
  navEntry,
  parseNavEntry,
  pushNav,
  rewriteNav,
  stepNav,
} from "./navHistory";

describe("pushNav", () => {
  test("appends the first note and points the cursor at it", () => {
    const s = pushNav(EMPTY_NAV, "a");
    expect(s).toEqual({ stack: ["a"], index: 0 });
  });

  test("grows a linear trail as notes open", () => {
    let s = pushNav(EMPTY_NAV, "a");
    s = pushNav(s, "b");
    s = pushNav(s, "c");
    expect(s).toEqual({ stack: ["a", "b", "c"], index: 2 });
  });

  test("reopening the current note is a no-op (same object)", () => {
    const s = pushNav(pushNav(EMPTY_NAV, "a"), "b");
    expect(pushNav(s, "b")).toBe(s);
  });

  test("re-recording a note you stepped back to still branches (only the CURRENT is deduped)", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "b"), "c"); // [a b c] @2
    s = stepNav(s, -1); // @1 (b)
    // opening "a" again is a genuine navigation → a new forward branch
    s = pushNav(s, "a");
    expect(s).toEqual({ stack: ["a", "b", "a"], index: 2 });
  });

  test("opening a note after stepping back TRUNCATES the forward branch", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "b"), "c"); // [a b c] @2
    s = stepNav(s, -1); // @1 (b)
    s = stepNav(s, -1); // @0 (a)
    s = pushNav(s, "z"); // opens z from a → forward (b, c) is gone
    expect(s).toEqual({ stack: ["a", "z"], index: 1 });
  });

  test("ignores empty ids", () => {
    expect(pushNav(EMPTY_NAV, "")).toBe(EMPTY_NAV);
  });

  test("caps the trail from the front", () => {
    let s: NavState = EMPTY_NAV;
    for (let i = 0; i < NAV_CAP + 5; i++) s = pushNav(s, `n${i}`);
    expect(s.stack.length).toBe(NAV_CAP);
    expect(s.index).toBe(NAV_CAP - 1);
    expect(s.stack[0]).toBe("n5"); // the first five fell off the front
    expect(s.stack[s.stack.length - 1]).toBe(`n${NAV_CAP + 4}`);
  });
});

describe("stepNav + can/at helpers", () => {
  const trail = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "b"), "c"); // [a b c] @2

  test("knows when Back/Forward are available", () => {
    expect(canBack(trail)).toBe(true);
    expect(canForward(trail)).toBe(false);
    expect(backId(trail)).toBe("b");
    expect(forwardId(trail)).toBe(null);
  });

  test("stepping back then forward returns to the same place", () => {
    const back = stepNav(trail, -1);
    expect(back.index).toBe(1);
    expect(canForward(back)).toBe(true);
    expect(forwardId(back)).toBe("c");
    const fwd = stepNav(back, 1);
    expect(fwd.index).toBe(2);
  });

  test("a step past either end is a no-op (same object)", () => {
    expect(stepNav(trail, 1)).toBe(trail); // already at the end
    const start = stepNav(stepNav(trail, -1), -1); // @0
    expect(stepNav(start, -1)).toBe(start); // already at the start
  });

  test("empty trail can neither go back nor forward", () => {
    expect(canBack(EMPTY_NAV)).toBe(false);
    expect(canForward(EMPTY_NAV)).toBe(false);
    expect(backId(EMPTY_NAV)).toBe(null);
    expect(forwardId(EMPTY_NAV)).toBe(null);
  });
});

// paper-cut sweep 2026-07-27: a hard-discarded blank note must leave the trail
// (Forward must never reopen a note that no longer exists), and Brain filing
// retargets rel-path entries the way it already retargets open tabs.
describe("dropNav", () => {
  test("removes every occurrence and keeps the cursor on its entry", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "n"), "b"); // [a n b] @2
    s = dropNav(s, "n");
    expect(s).toEqual({ stack: ["a", "b"], index: 1 });
  });

  test("dropping the CURRENT entry lands the cursor on the previous survivor", () => {
    const s = dropNav(pushNav(pushNav(EMPTY_NAV, "a"), "n"), "n"); // [a n] @1
    expect(s).toEqual({ stack: ["a"], index: 0 });
  });

  test("collapses the adjacent duplicates a removal creates", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "n"), "a"); // [a n a] @2
    s = dropNav(s, "n");
    expect(s).toEqual({ stack: ["a"], index: 0 });
  });

  test("an id not in the trail is a no-op (same object)", () => {
    const s = pushNav(EMPTY_NAV, "a");
    expect(dropNav(s, "zz")).toBe(s);
  });

  test("dropping the only entry empties the trail", () => {
    expect(dropNav(pushNav(EMPTY_NAV, "a"), "a")).toEqual({ stack: [], index: -1 });
  });
});

describe("rewriteNav", () => {
  test("maps every occurrence to the new id, cursor unmoved", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "old"), "b"), "old"); // [old b old] @2
    s = stepNav(s, -1); // @1
    s = rewriteNav(s, "old", "new");
    expect(s).toEqual({ stack: ["new", "b", "new"], index: 1 });
  });

  test("collapses adjacent duplicates the rewrite creates", () => {
    const s = rewriteNav(pushNav(pushNav(EMPTY_NAV, "a"), "old"), "old", "a"); // [a old] @1
    expect(s).toEqual({ stack: ["a"], index: 0 });
  });

  test("an id not in the trail is a no-op (same object)", () => {
    const s = pushNav(EMPTY_NAV, "a");
    expect(rewriteNav(s, "zz", "yy")).toBe(s);
  });
});

// paper-cut sweep 2026-07-27 (#6): the trail records every CONTENT surface —
// notes stay bare ids (compat with drop/retarget callers), boards/chats/files
// carry a kind prefix so replay can dispatch to the right opener.
describe("navEntry / parseNavEntry", () => {
  test("notes stay bare ids — ULIDs and rel paths alike", () => {
    expect(navEntry("note", "01HZX")).toBe("01HZX");
    expect(parseNavEntry("01HZX")).toEqual({ kind: "note", id: "01HZX" });
    expect(parseNavEntry("wiki/_inbox/foo.md")).toEqual({ kind: "note", id: "wiki/_inbox/foo.md" });
  });

  test("canvas, chat, and file entries round-trip through their prefix", () => {
    for (const kind of ["canvas", "chat", "file"] as const) {
      const entry = navEntry(kind, "storage/x.bin");
      expect(entry).toBe(`${kind}:storage/x.bin`);
      expect(parseNavEntry(entry)).toEqual({ kind, id: "storage/x.bin" });
    }
  });
});
