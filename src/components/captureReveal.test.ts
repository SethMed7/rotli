// The multi-select clobber repro (perf audit 2026-07-30, correctness #5):
// after a reveal ran once, a captures-list churn (same focus, same nonce —
// exactly what an unrelated mainTree/quickIds change produces) must NOT ask
// to fire again, or the board resets a multi-select mid-flight.

import { describe, expect, test } from "bun:test";

import { pendingRevealKey } from "./captureReveal";

describe("pendingRevealKey", () => {
  test("fires for a focused capture the first time", () => {
    expect(pendingRevealKey(null, "a", 1, ["a", "b"])).toBe("a:1");
  });

  test("does NOT re-fire on captures churn once handled (the clobber repro)", () => {
    const handled = pendingRevealKey(null, "a", 1, ["a", "b"]);
    // unrelated invalidation re-derives the list; focus + nonce unchanged
    expect(pendingRevealKey(handled, "a", 1, ["a", "b", "c"])).toBeNull();
  });

  test("re-fires when the user reveals again (nonce moved)", () => {
    expect(pendingRevealKey("a:1", "a", 2, ["a"])).toBe("a:2");
  });

  test("re-fires when focus moves to another capture", () => {
    expect(pendingRevealKey("a:1", "b", 1, ["a", "b"])).toBe("b:1");
  });

  test("stays quiet when the focused note is not a capture (or nothing is focused)", () => {
    expect(pendingRevealKey(null, "x", 1, ["a", "b"])).toBeNull();
    expect(pendingRevealKey(null, null, 1, ["a"])).toBeNull();
  });

  test("waits for a late-loading list, then fires once it holds the note", () => {
    expect(pendingRevealKey(null, "a", 1, [])).toBeNull();
    expect(pendingRevealKey(null, "a", 1, ["a"])).toBe("a:1");
  });
});
