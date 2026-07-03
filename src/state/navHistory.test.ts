// Pure-reducer tests for the Back/Forward trail (#14). The store's suppress
// flag + side effects are trivial wrappers; the branching logic lives in these
// pure functions, so this is where the coverage belongs.

import { describe, expect, it } from "bun:test";
import {
  EMPTY_NAV,
  NAV_CAP,
  type NavState,
  backId,
  canBack,
  canForward,
  forwardId,
  pushNav,
  stepNav,
} from "./navHistory";

describe("pushNav", () => {
  it("appends the first note and points the cursor at it", () => {
    const s = pushNav(EMPTY_NAV, "a");
    expect(s).toEqual({ stack: ["a"], index: 0 });
  });

  it("grows a linear trail as notes open", () => {
    let s = pushNav(EMPTY_NAV, "a");
    s = pushNav(s, "b");
    s = pushNav(s, "c");
    expect(s).toEqual({ stack: ["a", "b", "c"], index: 2 });
  });

  it("reopening the current note is a no-op (same object)", () => {
    const s = pushNav(pushNav(EMPTY_NAV, "a"), "b");
    expect(pushNav(s, "b")).toBe(s);
  });

  it("re-recording a note you stepped back to still branches (only the CURRENT is deduped)", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "b"), "c"); // [a b c] @2
    s = stepNav(s, -1); // @1 (b)
    // opening "a" again is a genuine navigation → a new forward branch
    s = pushNav(s, "a");
    expect(s).toEqual({ stack: ["a", "b", "a"], index: 2 });
  });

  it("opening a note after stepping back TRUNCATES the forward branch", () => {
    let s = pushNav(pushNav(pushNav(EMPTY_NAV, "a"), "b"), "c"); // [a b c] @2
    s = stepNav(s, -1); // @1 (b)
    s = stepNav(s, -1); // @0 (a)
    s = pushNav(s, "z"); // opens z from a → forward (b, c) is gone
    expect(s).toEqual({ stack: ["a", "z"], index: 1 });
  });

  it("ignores empty ids", () => {
    expect(pushNav(EMPTY_NAV, "")).toBe(EMPTY_NAV);
  });

  it("caps the trail from the front", () => {
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

  it("knows when Back/Forward are available", () => {
    expect(canBack(trail)).toBe(true);
    expect(canForward(trail)).toBe(false);
    expect(backId(trail)).toBe("b");
    expect(forwardId(trail)).toBe(null);
  });

  it("stepping back then forward returns to the same place", () => {
    const back = stepNav(trail, -1);
    expect(back.index).toBe(1);
    expect(canForward(back)).toBe(true);
    expect(forwardId(back)).toBe("c");
    const fwd = stepNav(back, 1);
    expect(fwd.index).toBe(2);
  });

  it("a step past either end is a no-op (same object)", () => {
    expect(stepNav(trail, 1)).toBe(trail); // already at the end
    const start = stepNav(stepNav(trail, -1), -1); // @0
    expect(stepNav(start, -1)).toBe(start); // already at the start
  });

  it("empty trail can neither go back nor forward", () => {
    expect(canBack(EMPTY_NAV)).toBe(false);
    expect(canForward(EMPTY_NAV)).toBe(false);
    expect(backId(EMPTY_NAV)).toBe(null);
    expect(forwardId(EMPTY_NAV)).toBe(null);
  });
});
