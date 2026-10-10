// The 404 page's game without a screen (site/src/runner/game.ts): it waits for Play, jumps and
// ducks, ends on a collision, speeds up a level at a time, and never asks for a jump and a
// duck at once. A seeded player that jumps what is on the sand and ducks what hangs over it
// proves every generated run can be survived at every speed. e2e/site/not-found-game.spec.ts
// proves the page's wiring. Like site-interactions.test.ts, the module loads through a
// computed path so its types stay out of the root typecheck.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

interface Obstacle {
  kind: string;
  x: number;
  w: number;
  h: number;
  lift: number;
}
interface Runner {
  y: number;
  vy: number;
  grounded: boolean;
  ducking: boolean;
}
interface Game {
  status: "ready" | "running" | "paused" | "over";
  distance: number;
  speed: number;
  runner: Runner;
  obstacles: Obstacle[];
  untilNext: number;
  width: number;
  best: number;
}
let game: {
  WORLD: {
    jumpSpeed: number;
    gravity: number;
    runnerX: number;
    runnerW: number;
    startSpeed: number;
    levelStep: number;
    levelEvery: number;
    maxLevel: number;
    overheadFrom: number;
    unitsPerMetre: number;
  };
  MAX_SPEED: number;
  SIZES: Record<string, { w: number; h: number; lift: number }>;
  createGame(width: number, best?: number): Game;
  start(g: Game): Game;
  jump(g: Game): Game;
  release(g: Game): Game;
  duck(g: Game, down: boolean): Game;
  pause(g: Game): Game;
  resume(g: Game): Game;
  step(g: Game, ms: number, random: () => number): Game;
  collides(runner: Runner, obstacle: Obstacle): boolean;
  clearance(speed: number): number;
  nextGap(speed: number, random: () => number, previousWidth?: number): number;
  nextKind(distance: number, random: () => number): string;
  isOverhead(o: { lift: number }): boolean;
  level(distance: number): number;
  levelSpeed(n: number): number;
  metres(distance: number): number;
};

beforeAll(async () => {
  game = (await import(join(import.meta.dir, "..", "site", "src", "runner", "game.ts"))) as typeof game;
});

const never = () => 0.99;
const run = (g: Game, ms: number, random = never) => {
  let next = g;
  for (let t = 0; t < ms; t += 16) next = game.step(next, 16, random);
  return next;
};
/** A small seeded generator, so a failing run can be replayed. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const standing = { y: 0, vy: 0, grounded: true, ducking: false };
const at = (kind: string, x = 96) => ({ kind, x, ...game.SIZES[kind]! });

describe("the 404 game", () => {
  test("never moves until Play, and a paused run stands still", () => {
    const ready = game.createGame(800);
    expect(game.step(ready, 1000, never)).toBe(ready);
    const running = run(game.start(ready), 500);
    expect(running.distance).toBeGreaterThan(0);
    const paused = game.pause(running);
    expect(game.step(paused, 1000, never).distance).toBe(running.distance);
    expect(game.resume(paused).status).toBe("running");
  });

  test("a jump rises, comes back down onto the sand, and cannot be repeated in the air", () => {
    let g = game.jump(game.start(game.createGame(800)));
    expect(g.runner.grounded).toBe(false);
    const again = game.jump(g);
    expect(again.runner.vy).toBe(g.runner.vy);
    g = run(g, 200);
    expect(g.runner.y).toBeGreaterThan(0);
    g = run(g, 1500);
    expect(g.runner).toEqual(standing);
  });

  test("letting go early makes a lower hop", () => {
    const full = run(game.jump(game.start(game.createGame(800))), 340);
    const short = run(game.release(run(game.jump(game.start(game.createGame(800))), 60)), 280);
    expect(short.runner.y).toBeLessThan(full.runner.y);
  });

  test("running into an obstacle ends the run, keeps the distance, and records the best", () => {
    const g = { ...game.start(game.createGame(800, 3)), obstacles: [at("rock", game.WORLD.runnerX + 30)] };
    const over = game.step(g, 16, never);
    expect(over.status).toBe("over");
    expect(over.best).toBe(3); // a short run does not lower the best
    const replay = game.start(over);
    expect(replay.status).toBe("running");
    expect(replay.obstacles).toEqual([]);
    expect(replay.best).toBe(3);
  });

  test("clearing an obstacle in the air is safe", () => {
    expect(game.collides(standing, at("rock"))).toBe(true);
    expect(game.collides({ ...standing, y: 40, grounded: false }, at("rock"))).toBe(false);
  });

  test("the score is metres, and a long frame (a hidden tab) never teleports the run", () => {
    expect(game.metres(game.WORLD.unitsPerMetre * 12.9)).toBe(12);
    const g = game.step(game.start(game.createGame(800)), 5000, never);
    expect(g.distance).toBeLessThan(40);
  });
});

describe("the 404 game: ducking", () => {
  test("ducked, the quokka passes under a gull or a branch that a standing quokka hits", () => {
    for (const kind of ["gull", "branch"]) {
      expect(game.collides(standing, at(kind))).toBe(true);
      expect(game.collides({ ...standing, ducking: true }, at(kind))).toBe(false);
    }
  });

  test("ducking never gets it past something on the sand", () => {
    for (const kind of ["rock", "bush", "log", "castle"])
      expect(game.collides({ ...standing, ducking: true }, at(kind))).toBe(true);
  });

  test("an overhead thing cannot be jumped: it reaches past the top of any jump", () => {
    let g = game.jump(game.start(game.createGame(800)));
    let top = 0;
    for (let t = 0; t < 1000; t += 16) {
      g = game.step(g, 16, never);
      top = Math.max(top, g.runner.y);
      expect(game.collides(g.runner, at("branch"))).toBe(true);
    }
    expect(top).toBeGreaterThan(100);
  });

  test("ducking in the air drops faster, and holds only while the game is on", () => {
    const up = run(game.jump(game.start(game.createGame(800))), 200);
    const plain = run(up, 150);
    const tucked = run(game.duck(up, true), 150);
    expect(tucked.runner.y).toBeLessThan(plain.runner.y);
    expect(game.duck(game.createGame(800), true).runner.ducking).toBe(false);
    // A pause lets go of the duck, so a run never resumes stuck low.
    expect(game.pause(game.duck(game.start(game.createGame(800)), true)).runner.ducking).toBe(false);
    // A jump stands up out of a duck.
    expect(game.jump(game.duck(game.start(game.createGame(800)), true)).runner.ducking).toBe(false);
  });
});

describe("the 404 game: speed", () => {
  test("it runs a level at a time: one more every few dozen metres, up to a cap", () => {
    const { levelEvery, unitsPerMetre, maxLevel, levelStep } = game.WORLD;
    expect(game.level(0)).toBe(1);
    expect(game.level((levelEvery - 1) * unitsPerMetre)).toBe(1);
    expect(game.level(levelEvery * unitsPerMetre)).toBe(2);
    expect(game.level(1e9)).toBe(maxLevel);
    expect(levelStep).toBeGreaterThanOrEqual(30); // each step can be felt
    expect(game.levelSpeed(maxLevel + 5)).toBe(game.MAX_SPEED);
  });

  test("a long run gets steadily faster and never past the cap", () => {
    let g = game.start(game.createGame(900));
    const speeds: number[] = [];
    for (let s = 0; s < 120; s++) {
      // Nothing in the way: only the pace is under test here.
      g = { ...run({ ...g, obstacles: [], untilNext: 1e9 }, 1000), untilNext: 1e9 };
      speeds.push(g.speed);
    }
    speeds.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(speeds[i]!));
    expect(speeds[0]).toBe(game.WORLD.startSpeed);
    expect(speeds.at(-1)).toBe(game.MAX_SPEED);
    expect(new Set(speeds.map((v) => Math.round(v))).size).toBeGreaterThan(game.WORLD.maxLevel);
  });

  test("overhead things wait until the visitor has learned the jump", () => {
    const early = (game.WORLD.overheadFrom - 1) * game.WORLD.unitsPerMetre;
    for (let i = 0; i < 200; i++)
      expect(game.isOverhead(game.SIZES[game.nextKind(early, Math.random)]!)).toBe(false);
    const later = game.WORLD.overheadFrom * game.WORLD.unitsPerMetre;
    const kinds = new Set(Array.from({ length: 400 }, () => game.nextKind(later, Math.random)));
    expect(kinds.has("gull") || kinds.has("branch")).toBe(true);
  });
});

describe("the 404 game: every run can be survived", () => {
  /** Jump what is on the sand, duck what hangs over it, nothing else. */
  function player(g: Game): Game {
    const { runnerX, runnerW } = game.WORLD;
    const next = g.obstacles.filter((o) => o.x + o.w > runnerX).sort((a, b) => a.x - b.x)[0];
    const gap = next ? next.x - (runnerX + runnerW) : Infinity;
    if (next && game.isOverhead(next) && gap < g.speed * 0.2) return game.duck(g, true);
    let out = game.duck(g, false);
    if (next && !game.isOverhead(next) && gap < g.speed * 0.08 + 6) out = game.jump(out);
    return out;
  }

  test("there is always room to land and react before the next thing, at any speed", () => {
    for (const speed of [game.WORLD.startSpeed, 520, game.MAX_SPEED]) {
      const airtime = (2 * game.WORLD.jumpSpeed) / game.WORLD.gravity;
      for (const w of [0, 44, 92])
        expect(game.nextGap(speed, () => 0, w) - w).toBeGreaterThan(speed * airtime + game.WORLD.runnerW);
    }
  });

  test("generated runs never put a jump and a duck at the same moment, and a careful player survives them", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const random = seeded(seed);
      let g = game.start(game.createGame(900));
      let overheads = 0;
      for (let t = 0; t < 110_000 && g.status === "running"; t += 16) {
        const until = g.untilNext;
        g = game.step(player(g), 16, random);
        if (g.untilNext > until) {
          // A new one at the right edge: open sand after the one before it, enough for a
          // whole jump and a moment to react, whatever each of them asks for.
          const [before, added] = [g.obstacles.at(-2), g.obstacles.at(-1)!];
          if (before) expect(added.x - (before.x + before.w)).toBeGreaterThanOrEqual(game.clearance(g.speed));
          if (game.isOverhead(added)) overheads++;
        }
      }
      expect(g.status, `seed ${seed} at ${game.metres(g.distance)} m`).toBe("running");
      expect(g.speed).toBe(game.MAX_SPEED);
      expect(overheads).toBeGreaterThan(3);
    }
  });
});
