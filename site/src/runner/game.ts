// The 404 page's game (src/pages/404.astro): the quokka runs along the beach and jumps what
// is in its way, and the score is how far it got. This file is the whole game without a
// screen, so it can be tested (scripts/site-runner.test.ts): a world in logical units (the
// stage is WORLD.height units tall, as wide as its aspect allows), y measured up from the
// sand, time in milliseconds. ./stage.ts draws it and turns keys and taps into jumps.

export type ObstacleKind = 'rock' | 'bush' | 'log' | 'castle';

export interface Obstacle {
  kind: ObstacleKind;
  /** Left edge, in world units from the stage's left. */
  x: number;
  w: number;
  h: number;
}

export interface Runner {
  /** Feet above the sand. */
  y: number;
  vy: number;
  grounded: boolean;
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
  height: 240,
  runnerX: 96,
  runnerW: 52,
  runnerH: 62,
  gravity: 2600,
  jumpSpeed: 900,
  /** Letting go early keeps this share of the rising speed: a short hop. */
  cut: 0.45,
  startSpeed: 330,
  maxSpeed: 700,
  /** Speed gained per second of running. */
  accel: 8,
  /** World units per metre on the score. */
  unitsPerMetre: 40,
} as const;

/** Each kind's footprint (width, height) in world units. */
export const SIZES: Record<ObstacleKind, { w: number; h: number }> = {
  rock: { w: 44, h: 30 },
  bush: { w: 54, h: 42 },
  log: { w: 72, h: 26 },
  castle: { w: 46, h: 52 },
};

const KINDS: readonly ObstacleKind[] = ['rock', 'bush', 'log', 'castle'];

export function createGame(width: number, best = 0): Game {
  return {
    status: 'ready',
    distance: 0,
    speed: WORLD.startSpeed,
    runner: { y: 0, vy: 0, grounded: true },
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
  return game.status === 'running' ? { ...game, status: 'paused' } : game;
}

export function resume(game: Game): Game {
  return game.status === 'paused' ? { ...game, status: 'running' } : game;
}

/** Jump, if the feet are on the sand and the game is on. */
export function jump(game: Game): Game {
  if (game.status !== 'running' || !game.runner.grounded) return game;
  return { ...game, runner: { y: game.runner.y, vy: WORLD.jumpSpeed, grounded: false } };
}

/** The jump key or finger came up: a jump still rising is cut short, for a small hop. */
export function release(game: Game): Game {
  const { runner } = game;
  if (runner.grounded || runner.vy <= WORLD.jumpSpeed * WORLD.cut) return game;
  return { ...game, runner: { ...runner, vy: runner.vy * WORLD.cut } };
}

export const metres = (distance: number) => Math.floor(distance / WORLD.unitsPerMetre);

/** The quokka's body and an obstacle overlap (both boxes forgive a little at the edges). */
export function collides(runner: Runner, obstacle: Obstacle): boolean {
  const left = WORLD.runnerX + 10;
  const right = WORLD.runnerX + WORLD.runnerW - 12;
  const bottom = runner.y + 4;
  return left < obstacle.x + obstacle.w - 6 && right > obstacle.x + 6 && bottom < obstacle.h - 4;
}

/** The gap before the next obstacle: always room to land and jump again at this speed. */
export function nextGap(speed: number, random: () => number): number {
  const airtime = (2 * WORLD.jumpSpeed) / WORLD.gravity; // seconds
  const least = speed * airtime + 140;
  return least + random() * (220 + speed * 0.4);
}

/**
 * Advance the game by `ms`. Only a running game moves; a fall ends the run and records the
 * best score. `random` decides the next obstacle and gap (Math.random on the page, a seeded
 * one in tests).
 */
export function step(game: Game, ms: number, random: () => number): Game {
  if (game.status !== 'running') return game;
  const dt = Math.min(ms, 50) / 1000; // a long frame (a hidden tab) never teleports
  const speed = Math.min(WORLD.maxSpeed, game.speed + WORLD.accel * dt);
  const travelled = speed * dt;

  let { y, vy, grounded } = game.runner;
  if (!grounded) {
    vy -= WORLD.gravity * dt;
    y += vy * dt;
    if (y <= 0) {
      y = 0;
      vy = 0;
      grounded = true;
    }
  }
  const runner = { y, vy, grounded };

  const obstacles = game.obstacles.map((o) => ({ ...o, x: o.x - travelled })).filter((o) => o.x + o.w > -20);
  let untilNext = game.untilNext - travelled;
  if (untilNext <= 0) {
    const kind = KINDS[Math.min(KINDS.length - 1, Math.floor(random() * KINDS.length))]!;
    obstacles.push({ kind, x: game.width + 10, ...SIZES[kind] });
    untilNext = nextGap(speed, random);
  }

  const distance = game.distance + travelled;
  const hit = obstacles.some((o) => collides(runner, o));
  if (hit) {
    return { ...game, status: 'over', runner, obstacles, distance, speed, untilNext, best: Math.max(game.best, metres(distance)) };
  }
  return { ...game, runner, obstacles, distance, speed, untilNext };
}
