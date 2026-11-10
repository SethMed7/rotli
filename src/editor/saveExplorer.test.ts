// The save-state explorer (seventh review of pull request 267): every
// interleaving of the person's moves, the disk's acknowledgements and the
// clock, up to a depth, for small scenarios; then seeded random walks for long
// ones. The world and the invariants (I1 to I5) are in
// saveExplorer.fixtures.ts.
//
// `bun test src/editor/saveExplorer.test.ts` runs the bounded search (part of
// the unit suite, so `verify quality`). `bun run test:explore` runs the full
// one (deeper, and more walks): see docs/testing.md. A failure prints the
// shortest schedule it found, as a `replay` you can paste into a plain test;
// a walk's failure prints its seed (EXPLORE_SEED=<seed> repeats it).
import { expect, test } from "bun:test";

import type { Scenario } from "./saveExplorer.fixtures";
import { type Exploration, exhaust, walk } from "./saveExplorerSearch.fixtures";

const FULL = process.env.EXPLORE === "full";

/** Each scenario, with its depth in the bounded run and the full one. Every
 * person move happens at most once per note unless `caps` says otherwise, and
 * at most one acknowledgement per schedule is failed or left never settling.
 * Every quit also waits on another window's flush, settled by the scheduler. */
export const SCENARIOS: { scenario: Scenario; depth: number; full: number }[] = [
  {
    scenario: {
      name: "a slow write, and undo",
      notes: [{ name: "A" }],
      moves: ["type", "undo", "quit", "release", "advance"],
    },
    depth: 9,
    full: 12,
  },
  {
    scenario: {
      name: "a query's answer arrives late",
      notes: [{ name: "A" }],
      moves: ["type", "refetch", "quit", "release", "advance"],
      caps: { type: 2, refetch: 2 },
    },
    depth: 8,
    full: 11,
  },
  {
    scenario: {
      name: "a note deleted with words in it",
      notes: [{ name: "A", secure: true }],
      moves: ["type", "purge", "discard", "quit", "release", "fail", "advance"],
      caps: { type: 2 },
    },
    depth: 8,
    full: 11,
  },
  {
    scenario: {
      name: "another app changes the note",
      notes: [{ name: "A", secure: true, locked: true }],
      moves: ["type", "outside", "quit", "release", "advance"],
      caps: { type: 2, outside: 2 },
    },
    depth: 7,
    full: 10,
  },
  {
    scenario: {
      name: "the disk fails, half-fails, or never answers",
      notes: [{ name: "A" }],
      moves: ["type", "undo", "release", "fail", "landFail", "never", "advance", "quit"],
    },
    depth: 8,
    full: 10,
  },
  {
    scenario: {
      name: "a conflict, and a disk that misbehaves",
      notes: [{ name: "A", secure: true, locked: true }],
      moves: ["type", "outside", "quit", "release", "fail", "landFail", "never", "advance"],
    },
    depth: 8,
    full: 9,
  },
  {
    scenario: {
      name: "two notes, switching and closing",
      notes: [{ name: "A" }, { name: "B", secure: true, locked: true }],
      moves: ["type", "switch", "close", "quit", "release", "advance"],
    },
    depth: 6,
    full: 8,
  },
];

/** The long walks (the seventh review's settings): every move, three notes. */
export const WALKS: Scenario = {
  name: "random walks",
  notes: [{ name: "A" }, { name: "B", secure: true, locked: true }, { name: "C", locked: true }],
  moves: [
    "type",
    "undo",
    "switch",
    "close",
    "outside",
    "purge",
    "refetch",
    "discard",
    "quit",
    "release",
    "fail",
    "landFail",
    "never",
    "advance",
  ],
  caps: { type: 5, undo: 3, outside: 3, purge: 2, refetch: 3, switch: 3, close: 2 },
  faults: 3,
};

function report(name: string, found: Exploration): string {
  return [...found.failures.values()]
    .map(
      ({ failure, trace }) =>
        `${name}: ${failure}\n  replay(scenario, ${JSON.stringify(trace.filter((line) => !line.startsWith("  ")))})\n  ${trace.join("\n  ")}`,
    )
    .join("\n\n");
}

for (const { scenario, depth, full } of SCENARIOS) {
  const limit = FULL ? full : depth;
  test(`every schedule up to ${limit} moves keeps I1 to I5: ${scenario.name}`, async () => {
    const found = await exhaust(scenario, limit);
    console.log(
      `  ${scenario.name}: ${found.schedules} schedules, depth ${limit}, ${Math.round(found.ms)} ms`,
    );
    expect(report(scenario.name, found)).toBe("");
  }, 600_000);
}

test("seeded random walks of 70 moves keep I1 to I5", async () => {
  const seed = Number(process.env.EXPLORE_SEED ?? 20261111);
  const walks = FULL ? 20_000 : 500;
  const found = await walk(WALKS, seed, walks, 70);
  console.log(
    `  random walks: ${found.schedules} walks of up to 70 moves, seed ${seed}, ${Math.round(found.ms)} ms`,
  );
  expect(report(`walks (seed ${seed})`, found)).toBe("");
}, 1_800_000);
