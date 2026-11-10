// The save-state explorer's search (seventh review of pull request 267): run
// one schedule, replay a printed one, every schedule up to a depth, or seeded
// random walks. The world and the invariants are in saveExplorer.fixtures.ts.
import { drain, type Move, type Scenario, World } from "./saveExplorer.fixtures";

export interface Run {
  trace: string[];
  /** How many moves were open at each step, and which one was taken. */
  radix: number[];
  taken: number[];
  failure: string | null;
  /** Whether each note's words were still owed at the end (the oracle's own state). */
  owed: Record<string, boolean>;
}

/** Run one schedule: at each step `choose` picks one of the open moves (by
 * index), until `depth` moves, no open move, or a broken invariant. */
export async function runSchedule(
  scenario: Scenario,
  choose: (moves: Move[], step: number) => number,
  depth: number,
): Promise<Run> {
  const world = new World(scenario);
  const run: Run = { trace: world.trace, radix: [], taken: [], failure: null, owed: {} };
  try {
    run.failure = world.check();
    for (let step = 0; step < depth && !run.failure; step += 1) {
      const moves = world.moves();
      if (moves.length === 0) break;
      const pick = choose(moves, step);
      if (pick < 0 || pick >= moves.length) throw new Error(`no move ${pick} at step ${step}`);
      run.radix.push(moves.length);
      run.taken.push(pick);
      world.trace.push(moves[pick]!.label);
      await moves[pick]!.run();
      await drain();
      run.failure = world.check();
    }
    if (!run.failure) run.failure = await world.finish();
    run.owed = world.owedNow();
  } finally {
    world.dispose();
  }
  return run;
}

/** Replay a schedule written as move labels (as a failure prints them). A
 * label may be a prefix: "release write" is the oldest held write. */
export function replay(scenario: Scenario, labels: string[]): Promise<Run> {
  return runSchedule(
    scenario,
    (moves, step) => {
      const want = labels[step]!;
      const at = moves.findIndex((move) => move.label === want || move.label.startsWith(want));
      if (at < 0)
        throw new Error(`step ${step}: “${want}” isn't open; open: ${moves.map((m) => m.label).join(" | ")}`);
      return at;
    },
    labels.length,
  );
}

/** A failure's kind, for counting distinct ones: the invariant and the note. */
export const signature = (failure: string) => failure.split(":")[0]!;

export interface Exploration {
  schedules: number;
  /** The shortest failing schedule for each distinct failure. */
  failures: Map<string, { failure: string; trace: string[] }>;
  ms: number;
}

/** Every schedule up to `depth` moves (stateless search: each schedule runs
 * from a fresh world; the next one changes the deepest step that has a move
 * left untried). */
export async function exhaust(
  scenario: Scenario,
  depth: number,
  limit = Number.POSITIVE_INFINITY,
): Promise<Exploration> {
  const started = performance.now();
  const out: Exploration = { schedules: 0, failures: new Map(), ms: 0 };
  let prefix: number[] = [];
  while (out.schedules < limit) {
    const run = await runSchedule(scenario, (_moves, step) => prefix[step] ?? 0, depth);
    out.schedules += 1;
    record(out, run);
    let i = run.radix.length - 1;
    while (i >= 0 && run.taken[i]! + 1 >= run.radix[i]!) i -= 1;
    if (i < 0) break;
    prefix = [...run.taken.slice(0, i), run.taken[i]! + 1];
  }
  out.ms = performance.now() - started;
  return out;
}

/** `walks` seeded random schedules of up to `depth` moves. */
export async function walk(
  scenario: Scenario,
  seed: number,
  walks: number,
  depth: number,
): Promise<Exploration> {
  const started = performance.now();
  const out: Exploration = { schedules: 0, failures: new Map(), ms: 0 };
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < walks; i += 1) {
    const run = await runSchedule(scenario, (moves) => Math.floor(random() * moves.length), depth);
    out.schedules += 1;
    record(out, run);
  }
  out.ms = performance.now() - started;
  return out;
}

function record(out: Exploration, run: Run): void {
  if (!run.failure) return;
  const key = signature(run.failure);
  const known = out.failures.get(key);
  const moves = run.trace.filter((line) => !line.startsWith("  "));
  if (!known || moves.length < known.trace.filter((line) => !line.startsWith("  ")).length)
    out.failures.set(key, { failure: run.failure, trace: run.trace });
}
