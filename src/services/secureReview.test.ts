// Lane-split locks for the secure review (feature B) — the three lanes must
// never overlap: detector-only rows are the confirm lane, flagged rows that
// the repair block owns disappear from here, and only the flagged rows neither
// lane can act on surface as the passive count.

import { describe, expect, test } from "bun:test";
import type { SecureHint } from "../lib/tauri";
import { deriveSecureReview } from "./secureReview";

const hint = (over: Partial<SecureHint>): SecureHint => ({
  rel: "wiki/_inbox/x.md",
  title: "X",
  flagged: false,
  ...over,
});

describe("deriveSecureReview", () => {
  test("detector-only rows land in the confirm lane", () => {
    const v = deriveSecureReview([hint({}), hint({ rel: "wiki/_inbox/y.md", title: "Y" })], []);
    expect(v.confirm.map((h) => h.title)).toEqual(["X", "Y"]);
    expect(v.flaggedLeftover).toBe(0);
  });

  test("flagged rows the repair block owns vanish from this surface", () => {
    const v = deriveSecureReview(
      [hint({ flagged: true, rel: "wiki/_inbox/stuck.md" })],
      [{ rel: "wiki/_inbox/stuck.md" }],
    );
    expect(v.confirm).toEqual([]);
    expect(v.flaggedLeftover).toBe(0);
  });

  test("flagged rows without a repair candidate count as passive leftovers", () => {
    const v = deriveSecureReview(
      [hint({ flagged: true, rel: "wiki/_inbox/idless.md" }), hint({ rel: "wiki/_inbox/hot.md" })],
      [],
    );
    expect(v.confirm.map((h) => h.rel)).toEqual(["wiki/_inbox/hot.md"]);
    expect(v.flaggedLeftover).toBe(1);
  });

  test("empty inputs stay empty", () => {
    expect(deriveSecureReview([], [])).toEqual({ confirm: [], flaggedLeftover: 0 });
  });
});
