// The permission differential harness, TypeScript side: the recorded
// verdicts are the TypeScript readers' now (the Rust suite compares its own
// against them), no case misses a denial oracle L carries, and the bulk
// stays at a few thousand cases so `bun run check` stays quick.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  cases,
  type Differential,
  FIXTURE,
  large,
  misses,
  oracleL,
  verdicts,
} from "./permission-differential";

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Differential;

test("the recorded verdicts are the TypeScript readers' (refresh: bun scripts/permission-differential.ts --write)", () => {
  for (const set of fixture.sets)
    expect({ set: set.name, same: verdicts(set) === fixture.verdicts[set.name] }).toEqual({
      set: set.name,
      same: true,
    });
});

test("no case misses a denial the plain line rule (oracle L) carries", () => {
  for (const set of fixture.sets) {
    const verdict = fixture.verdicts[set.name]!;
    const missed = cases(set)
      .map((fields, i) => ({ fields, verdict: verdict.slice(i * 4, i * 4 + 4) }))
      .filter(({ fields, verdict }) => misses(verdict, oracleL(fields)).length > 0);
    expect({ set: set.name, missed: missed.slice(0, 10) }).toEqual({ set: set.name, missed: [] });
  }
});

test("every set the reviews named is in the run, at a few thousand cases", () => {
  expect(fixture.sets.map((set) => set.name)).toEqual(["pool303", "reviewers", "structural", "spelling"]);
  const total = fixture.sets.reduce((n, set) => n + cases(set).length, 0);
  expect(total).toBeGreaterThan(5000);
  expect(total).toBeLessThan(10000);
  expect(large(fixture.sets).reduce((n, set) => n + cases(set).length, 0)).toBeGreaterThan(100000);
});

test("oracle L sees what the rules name and nothing the readers decide alone", () => {
  expect(oracleL(['"locked": yes']).lock).toBe(true);
  expect(oracleL(["x: 1\rsecure: true"]).secure).toBe(true);
  expect(oracleL(["created_by: agent", "{ai_edit: false}"]).editDeny).toBe(true);
  expect(oracleL(["notes: |", "  locked: true"]).lock).toBe(false);
  expect(oracleL(["locked: false"]).lock).toBe(false);
  // YAML folds a deeper plain line into the value (review of PR 307, H1)
  expect(oracleL(["secure: false", "  until friday"]).secure).toBe(true);
  expect(oracleL(["locked: no", "  - later"]).lock).toBe(true);
  expect(oracleL(["x: 1\rsecure: off", "  more"]).secure).toBe(true);
  expect(oracleL(["created_by: agent", "ai_edit: true", "  until friday"]).editDeny).toBe(true);
  expect(oracleL(["secure: false", "  # note"]).secure).toBe(false);
  expect(oracleL(["secure: false", "  x: y"]).secure).toBe(false);
});
