// The frontmatter differential harness, TypeScript side (review of pull
// request 303): the recorded verdicts are what the TypeScript readers give
// now (the Rust suite compares its own against them), and no case where a
// line says no to AI reads as allowed.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  carriesDenial,
  cases,
  type Differential,
  FIXTURE,
  run,
  verdict,
} from "../../scripts/frontmatter-differential";

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Differential;

test("the recorded verdicts are the TypeScript readers' (refresh: bun scripts/frontmatter-differential.ts --write)", () => {
  expect(run(fixture) === fixture.verdicts).toBe(true);
});

test("no frontmatter that says no to AI reads as allowed", () => {
  const leaks = cases(fixture).filter((fields) => {
    const [body, local] = verdict(fields);
    const denial = carriesDenial(fields);
    return (denial.edit && body === "a") || (denial.local && local === "t");
  });
  expect(leaks.slice(0, 20)).toEqual([]);
});
