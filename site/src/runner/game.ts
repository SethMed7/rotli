// The 404 page's game (src/pages/404.astro): the quokka runs along the beach, jumps what is in
// its way, ducks under what hangs over it, and the score is how far it got. This file is the
// whole game without a screen, so it can be tested (scripts/site-runner.test.ts): a world in
// logical units (the stage is WORLD.height units tall, as wide as its aspect allows), y
// measured up from the sand, time in milliseconds. ./stage.ts draws it and turns keys and
// taps into jumps and ducks.
//
// It gets faster a step at a time (the owner, 2026-10-05: "it should incrementally get
// faster"): every WORLD.levelEvery metres is a new level, a little quicker than the last, up
// to WORLD.maxLevel. Overhead things (a gull, a low branch) join the rocks once the visitor
// has had a few to learn the jump on, and there is always room to land before the next thing
// in the way, so a run never asks for a jump and a duck at once.

/** Things on the sand, to jump; things overhead, to duck under. */
export type GroundKind = 'rock' | 'bush' | 'log' | 'castle';
export type OverheadKind = 'gull' | 'branch';
export type ObstacleKind = GroundKind | OverheadKind;

export interface Obstacle {
  kind: ObstacleKind;
  /** Left edge, in world units from the stage's left. */
  x: number;
  w: number;
  h: number;
  /** How far its underside is above the sand: 0 for things on the sand. */
  lift: number;
}

export interface Runner {
  /** Feet above the sand. */
  y: number;
  vy: number;
  grounded: boolean;
  /** Ducking (sliding along the sand, or tucked and dropping fast in the air). */
  ducking: boolean;
}

export type Status = 'ready' | 'running' | 'paused' | 'over';

export interface Game {
  status: Status;
  /** World units travelled this run. */
  distance: number;
  speed: number;
  runner: Runner;
  obstacles: Obstacle[];
  /** Distance still to cover before the next obstacle appears at the right edge. */
  untilNext: number;
  /** The visible width of the world, in units (it follows the stage's shape). */
  width: number;
  /** Best score this visit, in metres (never stored: the page keeps no data). */
  best: number;
}

export const WORLD = {
  height: 300,
  runnerX: 96,
  runnerW: 52,
  runnerH: 62,
  /** Ducked, the quokka is this tall: under anything overhead, still over nothing on the sand. */
  duckH: 32,
  gravity: 2600,
  /** Tucked in the air, it drops this much faster (a duck mid-jump comes down quickly). */
  diveGravity: 3,
  jumpSpeed: 900,
  /** Letting go early keeps this share of the rising speed: a short hop. */
  cut: 0.45,
  startSpeed: 340,
  /** Each level is this much faster than the one before. */
  levelStep: 38,
  /** A new level every this many metres. */
  levelEvery: 75,
  maxLevel: 10,
  /** How quickly the speed eases up to a new level's, units per second². */
  accel: 90,
  /** Overhead things start appearing after this many metres. */
  overheadFrom: 30,
  /** World units per metre on the score. */
  unitsPerMetre: 40,
} as const;

/** The fastest a run gets: the top level's speed. */
export const MAX_SPEED = WORLD.startSpeed + (WORLD.maxLevel - 1) * WORLD.levelStep;

/** Each kind's footprint (width, height, and how high its underside is) in world units. An
 * overhead thing reaches up past the top of any jump, so it can only be ducked under. */
export const SIZES: Record<ObstacleKind, { w: number; h: number; lift: number }> = {
  rock: { w: 44, h: 30, lift: 0 },
  bush: { w: 54, h: 42, lift: 0 },
  log: { w: 72, h: 26, lift: 0 },
  castle: { w: 46, h: 52, lift: 0 },
  gull: { w: 50, h: 400, lift: 42 },
  branch: { w: 92, h: 400, lift: 44 },
};

const GROUND: readonly GroundKind[] = ['rock', 'bush', 'log', 'castle'];
const OVERHEAD: readonly OverheadKind[] = ['gull', 'branch'];

export const isOverhead = (o: Pick<Obstacle, 'lift'>) => o.lift > 0;

export function createGame(width: number, best = 0): Game {
  return {
    status: 'ready',
    distance: 0,
    speed: WORLD.startSpeed,
    runner: { y: 0, vy: 0, grounded: true, ducking: false },
    obstacles: [],
    untilNext: width * 0.6,
    width,
    best,
  };
}

/** A fresh run (from ready, or again after a fall), keeping the best score. */
export function start(game: Game): Game {
  return { ...createGame(game.width, game.best), status: 'running' };
}

export function pause(game: Game): Game {
  if (game.status !== 'running') return game;
  return { ...game, status: 'paused', runner: { ...game.runner, ducking: false } };
}

export function resume(game: Game): Game {
  return game.status === 'paused' ? { ...game, status: 'running' } : game;
}

/** Jump, if the feet are on the sand and the game is on. A jump stands up out of a duck. */
export function jump(game: Game): Game {
  if (game.status !== 'running' || !game.runner.grounded) return game;
  return { ...game, runner: { y: game.runner.y, vy: WORLD.jumpSpeed, grounded: false, ducking: false } };
}

/** The jump key or finger came up: a jump still rising is cut short, for a small hop. */
export function release(game: Game): Game {
  const { runner } = game;
  if (runner.grounded || runner.vy <= WORLD.jumpSpeed * WORLD.cut) return game;
  return { ...game, runner: { ...runner, vy: runner.vy * WORLD.cut } };
}

/** Duck while the key (or finger) is held: slide on the sand, or tuck and drop in the air. */
export function duck(game: Game, down: boolean): Game {
  if (game.runner.ducking === down) return game;
  if (down && game.status !== 'running') return game;
  return { ...game, runner: { ...game.runner, ducking: down } };
}

export const metres = (distance: number) => Math.floor(distance / WORLD.unitsPerMetre);

/** The level a run has reached at this distance: 1 at the start, one more every levelEvery
 * metres, never past maxLevel. */
export function level(distance: number): number {
  return Math.min(WORLD.maxLevel, 1 + Math.floor(metres(distance) / WORLD.levelEvery));
}

/** The speed a level runs at. */
export const levelSpeed = (n: number) => WORLD.startSpeed + (Math.min(WORLD.maxLevel, n) - 1) * WORLD.levelStep;

/** How tall the quokka stands right now. */
export const height = (runner: Runner) => (runner.ducking ? WORLD.duckH : WORLD.runnerH);

/** The quokka's body and an obstacle overlap (both boxes forgive a little at the edges). */
export function collides(runner: Runner, obstacle: Obstacle): boolean {
  const left = WORLD.runnerX + 10;
  const right = WORLD.runnerX + WORLD.runnerW - 12;
  if (!(left < obstacle.x + obstacle.w - 6 && right > obstacle.x + 6)) return false;
  const bottom = runner.y + 4;
  const top = runner.y + height(runner) - 6;
  return bottom < obstacle.lift + obstacle.h - 4 && top > obstacle.lift + 4;
}

/** Seconds a full jump spends in the air. */
export const airtime = () => (2 * WORLD.jumpSpeed) / WORLD.gravity;

/** The open sand a run needs between one thing and the next at this speed: a whole jump,
 * the quokka's own length, and a moment to react (to land and duck, or stand up and jump). */
export const clearance = (speed: number) => speed * airtime() + WORLD.runnerW + 0.22 * speed;

/**
 * The distance from one obstacle's left edge to the next one's: the clearance after the
 * previous obstacle's width, and a random stretch on top so the rhythm varies.
 */
export function nextGap(speed: number, random: () => number, previousWidth = 0): number {
  return previousWidth + clearance(speed) + 60 + random() * (220 + speed * 0.4);
}

/** The next thing in the way: ground things from the start, overhead ones mixed in (about a
 * third of the time) once the run is past WORLD.overheadFrom metres. */
export function nextKind(distance: number, random: () => number): ObstacleKind {
  const pick = <T>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  if (metres(distance) >= WORLD.overheadFrom && random() < 0.34) return pick(OVERHEAD);
  return pick(GROUND);
}

/**
 * Advance the game by `ms`. Only a running game moves; a fall ends the run and records the
 * best score. `random` decides the next obstacle and gap (Math.random on the page, a seeded
 * one in tests).
 */
export function step(game: Game, ms: number, random: () => number): Game {
  if (game.status !== 'running') return game;
  const dt = Math.min(ms, 50) / 1000; // a long frame (a hidden tab) never teleports
  const target = levelSpeed(level(game.distance));
  const speed = Math.min(target, game.speed + WORLD.accel * dt);
  const travelled = speed * dt;

  let { y, vy, grounded } = game.runner;
  const { ducking } = game.runner;
  if (!grounded) {
    vy -= WORLD.gravity * (ducking ? WORLD.diveGravity : 1) * dt;
    y += vy * dt;
    if (y <= 0) {
      y = 0;
      vy = 0;
      grounded = true;
    }
  }
  const runner = { y, vy, grounded, ducking };

  const obstacles = game.obstacles.map((o) => ({ ...o, x: o.x - travelled })).filter((o) => o.x + o.w > -20);
  let untilNext = game.untilNext - travelled;
  if (untilNext <= 0) {
    const kind = nextKind(game.distance, random);
    const size = SIZES[kind];
    obstacles.push({ kind, x: game.width + 10, ...size });
    untilNext = nextGap(speed, random, size.w);
  }

  const distance = game.distance + travelled;
  const hit = obstacles.some((o) => collides(runner, o));
  if (hit) {
    return { ...game, status: 'over', runner, obstacles, distance, speed, untilNext, best: Math.max(game.best, metres(distance)) };
  }
  return { ...game, runner, obstacles, distance, speed, untilNext };
}
