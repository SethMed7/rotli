// The footer scene's rules, kept free of the DOM so they can be tested (scripts/site-quokka-
// play.test.ts): who a dropped leaf goes to, how a thrown ball travels, how a dropped leaf
// falls, and how the guard feels about all of it.

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The resident a leaf released at `point` goes to: the one whose box, grown by `reach`
 * pixels, contains the point and whose middle is nearest; null when it lands on open sand.
 */
export function dropTarget<T extends { box: Box }>(point: Point, residents: readonly T[], reach: number): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const resident of residents) {
    const { left, top, right, bottom } = resident.box;
    if (right <= left || bottom <= top) continue; // hidden at this width
    const inside =
      point.x >= left - reach && point.x <= right + reach && point.y >= top - reach && point.y <= bottom + reach;
    if (!inside) continue;
    const distance = Math.hypot(point.x - (left + right) / 2, point.y - (top + bottom) / 2);
    if (distance < bestDistance) {
      best = resident;
      bestDistance = distance;
    }
  }
  return best;
}

/** A point along a thrown arc: `t` from 0 to 1, peaking `lift` pixels above the higher end. */
export function arc(from: Point, to: Point, t: number, lift: number): Point {
  const k = Math.min(1, Math.max(0, t));
  const peak = Math.min(from.y, to.y) - lift;
  // A parabola through both ends whose vertex sits at `peak`.
  const a = from.y - peak;
  const b = to.y - peak;
  const vertex = Math.sqrt(a) / (Math.sqrt(a) + Math.sqrt(b) || 1);
  const y =
    k <= vertex
      ? peak + a * ((vertex - k) / (vertex || 1)) ** 2
      : peak + b * ((k - vertex) / (1 - vertex || 1)) ** 2;
  return { x: from.x + (to.x - from.x) * k, y };
}

/**
 * A leaf let go over open sand drifts down: it falls at a steady pace (it is a leaf, not a
 * stone), swaying side to side, and rests on `ground`. Returns where it is and how it is
 * turned `ms` after release, and whether it has landed.
 */
export function leafFall(from: Point, ground: number, ms: number): Point & { angle: number; landed: boolean } {
  const speed = 0.16; // px per ms
  const y = Math.min(ground, from.y + speed * ms);
  const landed = y >= ground;
  const sway = landed ? 0 : Math.sin(ms / 170);
  return { x: from.x + sway * 14, y, angle: sway * 28, landed };
}

export type Mood = '' | 'mad' | 'sad' | 'happy';

/** The leaves as the guard sees them, most pressing first. */
export interface LeafState {
  /** A leaf was just handed to someone. */
  delivered: boolean;
  /** A leaf was dropped on the sand and not yet cleared away. */
  dropped: boolean;
  /** The visitor is carrying a leaf. */
  carried: boolean;
  /** The visitor's pointer is at the pile itself. */
  onPile: boolean;
  /** The visitor's pointer is near the pile. */
  nearPile: boolean;
}

/**
 * The guard minds the pile: pleased when a leaf reaches a quokka, sad when one is wasted on
 * the sand or a hand rests right on the pile, cross while someone carries their lunch off or
 * reaches toward it, and calm otherwise.
 */
export function guardMood(state: LeafState): Mood {
  if (state.delivered) return 'happy';
  if (state.dropped) return 'sad';
  if (state.carried) return 'mad';
  if (state.onPile) return 'sad';
  if (state.nearPile) return 'mad';
  return '';
}
