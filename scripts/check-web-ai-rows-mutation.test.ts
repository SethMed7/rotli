import { describe, expect, test } from "bun:test";

import { MUTANTS, mutate, mutationFailures } from "./check-web-ai-rows-mutation.mjs";

describe("check:web-ai-rows-mutation", () => {
  test("the web AI corpus's row test fails on every planted spread, and passes without one", () => {
    expect(mutationFailures(process.cwd())).toEqual([]);
  }, 60_000);

  test("a mutant whose text is gone says so, rather than passing quietly", () => {
    expect(() => mutate("nothing to mutate here", MUTANTS[0]!)).toThrow(/no longer in/);
  });
});
