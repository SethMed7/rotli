// The person in the footer scene (the owner, 2026-10-05: "when I am hovering over it with my
// mouse it inserts a human I am controlling. I can walk my human all the way to the food and
// feed the quokkas. I can also go play with the quokkas with the ball"; and later the same day:
// "when my mouse is there let me use arrows to move ... I can click what quokka to throw the
// ball to or give feed to"). These are its rules without the DOM, so they can be tested
// (scripts/site-interactions.test.ts): how it walks where it is sent (setting off briskly,
// slowing to arrive, never overshooting), how its legs and arms swing, what a click asks of
// it, and what it does where it stops. src/quokka/scene.ts draws it.

/** Walking: top speed and how quickly it gets there or stops, in px and ms. */
export const STRIDE = {
  /** Top speed, px per ms (a brisk walk across a 1440px beach takes about four seconds). */
  speed: 0.36,
  /** How fast it speeds up and slows down, px per ms²: up to speed in about a tenth of a
   * second, so a click or an arrow key feels answered at once. */
  accel: 0.0034,
  /** How gently it slows to arrive, px per ms²: softer than setting off, so it settles
   * onto the spot rather than braking hard. */
  brake: 0.0012,
  /** Close enough to where it was going to count as there, px. */
  near: 4,
  /** px walked per full cycle of both legs. */
  cycle: 64,
} as const;

export interface Walk {
  x: number;
  /** Velocity, px per ms: signed, positive to the right. */
  v: number;
  facing: 1 | -1;
  /** Where the legs are in their cycle, radians. */
  phase: number;
}

export function createWalk(x: number, facing: 1 | -1 = 1): Walk {
  return { x, v: 0, facing, phase: 0 };
}

/**
 * One step toward `target` over `ms`. It speeds up to a walk, slows down as it arrives (the
 * speed that lets it stop in the distance left), and lands exactly; `teleport` (reduced motion)
 * puts it there at once, standing still.
 */
export function stepWalk(walk: Walk, target: number, ms: number, teleport = false): Walk {
  const gap = target - walk.x;
  if (teleport) return { x: target, v: 0, facing: gap === 0 ? walk.facing : gap > 0 ? 1 : -1, phase: 0 };
  const dt = Math.min(64, Math.max(0, ms));
  const distance = Math.abs(gap);
  if (distance <= STRIDE.near && Math.abs(walk.v) < STRIDE.accel * 40) {
    return { ...walk, x: target, v: 0, phase: 0 };
  }
  const want = Math.sign(gap) * Math.min(STRIDE.speed, Math.sqrt(2 * STRIDE.brake * distance));
  const dv = Math.max(-STRIDE.accel * dt, Math.min(STRIDE.accel * dt, want - walk.v));
  let v = walk.v + dv;
  let x = walk.x + v * dt;
  // Never past the target: arriving is a stop, not a wobble.
  if (gap === 0 || (gap > 0 && x >= target) || (gap < 0 && x <= target)) {
    x = target;
    v = 0;
  }
  const facing: 1 | -1 = Math.abs(v) > 0.01 ? (v > 0 ? 1 : -1) : walk.facing;
  const phase = (walk.phase + (Math.abs(v * dt) / STRIDE.cycle) * 2 * Math.PI) % (2 * Math.PI);
  return { x, v, facing, phase };
}

/** Whether it has stopped where it was going. */
export function arrived(walk: Walk, target: number): boolean {
  return Math.abs(walk.x - target) <= STRIDE.near && walk.v === 0;
}

/** The swing of a walk at this phase and speed: legs and arms in degrees (each pair swings
 * opposite ways), and the bob of the body in drawing units (up is negative). Standing, all 0. */
export function limbs(walk: Walk): { leg: number; arm: number; bob: number } {
  const pace = Math.min(1, Math.abs(walk.v) / STRIDE.speed);
  if (pace === 0) return { leg: 0, arm: 0, bob: 0 };
  const swing = Math.sin(walk.phase);
  return { leg: 26 * pace * swing, arm: 20 * pace * swing, bob: -2.4 * pace * Math.abs(Math.cos(walk.phase)) };
}

/** What stands at a point on the beach, as far as the person is concerned. */
export interface Spot {
  /** The leaf pile. */
  pile: boolean;
  /** The quokka there, if any (its name in the scene). */
  quokka: string | null;
  /** Between (or at) the two playing catch. */
  players: boolean;
}

export type Deed = 'pick' | 'feed' | 'join' | null;

/**
 * What the person does on stopping somewhere: picks a leaf off the pile with empty hands,
 * hands the leaf it carries to the quokka it stopped at, and otherwise, at the corner where
 * the ball is, joins the game. Passing by does nothing; only stopping counts.
 */
export function deed(holding: boolean, spot: Spot): Deed {
  if (holding && spot.quokka) return 'feed';
  if (!holding && spot.pile) return 'pick';
  if (!holding && spot.players) return 'join';
  return null;
}

/** Where on the beach it may stand: its whole body inside the band. */
export function onSand(x: number, width: number, bodyWidth: number): number {
  const half = bodyWidth / 2;
  return Math.min(width - half, Math.max(half, x));
}

/** Where it appears: a short walk in from the side nearer the edge it came from, so it is seen
 * arriving rather than popping up under the pointer. */
export function entrance(target: number, width: number, bodyWidth: number): number {
  const from = target < width / 2 ? target - 140 : target + 140;
  return onSand(from, width, bodyWidth);
}

/** What the visitor clicked or tapped on the beach. */
export type Hit = 'pile' | 'ball' | 'quokka' | 'sand';
/** What the person has in hand. */
export type Holding = 'leaf' | 'ball' | null;
/**
 * What a click asks of the person:
 *   fetch  walk to the pile and pick a leaf up
 *   feed   walk to the quokka and hand it the leaf
 *   throw  throw the ball to that quokka (now, if it holds the ball; else its next catch)
 *   join   walk to the two with the ball and join their game
 *   visit  walk to stand beside that quokka (it is pleased to see you)
 *   walk   walk there
 */
export type Command = 'fetch' | 'feed' | 'throw' | 'join' | 'visit' | 'walk' | null;

export function command(holding: Holding, hit: Hit, context: { joined: boolean; player: boolean }): Command {
  if (hit === 'pile') return holding === null ? 'fetch' : 'walk';
  if (hit === 'ball') return holding === null ? 'join' : holding === 'ball' ? null : 'walk';
  if (hit === 'quokka') {
    if (holding === 'leaf') return 'feed';
    if (holding === 'ball' || context.joined) return 'throw';
    return context.player ? 'join' : 'visit';
  }
  return 'walk';
}
