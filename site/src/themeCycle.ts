// The theme studio's autoplay (Personal.astro; the owner, 2026-10-05: "when you arrive it
// should be going through them on its own and change on what you hover over"). Once the studio
// is revealed it steps through the fourteen environments at a calm pace. Hovering or focusing a
// swatch shows that environment at once and holds the cycle; leaving lets it go on from there
// after a short pause. A click, or the carousel's previous and next, pins a choice: the cycle
// stops for good, and a hover only previews, returning to the pinned one on leaving. Under
// reduced motion there is no autoplay at all. The page pauses the clock while the studio is
// off screen or the tab is hidden.
//
// No DOM here, so the timing can be tested (scripts/site-interactions.test.ts).

/** How long each environment stays before the next, while it plays on its own. */
export const CYCLE_MS = 3200;
/** How long after the pointer (or focus) leaves the swatches the cycle carries on. */
export const RESUME_MS = 2400;

export type CycleMode = 'auto' | 'held' | 'pinned' | 'off';

export interface Cycle {
  total: number;
  /** The environment on show. */
  shown: number;
  mode: CycleMode;
  /** The environment a click chose (pinned mode). */
  pinned: number;
  /** When the next automatic step is due (auto mode), in ms. */
  nextAt: number;
}

const wrap = (index: number, total: number) => ((index % total) + total) % total;

/** A studio just revealed: it plays unless the visitor asked for reduced motion. */
export function createCycle(total: number, now: number, autoplay: boolean): Cycle {
  return { total, shown: 0, mode: autoplay ? 'auto' : 'off', pinned: 0, nextAt: now + CYCLE_MS };
}

/** The clock: in auto mode, one step once it is due. Anything else stands still. */
export function tick(cycle: Cycle, now: number): Cycle {
  if (cycle.mode !== 'auto' || now < cycle.nextAt || cycle.total < 2) return cycle;
  return { ...cycle, shown: wrap(cycle.shown + 1, cycle.total), nextAt: now + CYCLE_MS };
}

/** A swatch under the pointer or the focus: shown at once, and the cycle holds. */
export function hover(cycle: Cycle, index: number): Cycle {
  const shown = wrap(index, cycle.total);
  if (cycle.mode === 'pinned' || cycle.mode === 'off') return { ...cycle, shown };
  return { ...cycle, shown, mode: 'held' };
}

/** The pointer or the focus left the swatches. */
export function leave(cycle: Cycle, now: number): Cycle {
  if (cycle.mode === 'pinned') return { ...cycle, shown: cycle.pinned };
  if (cycle.mode === 'held') return { ...cycle, mode: 'auto', nextAt: now + RESUME_MS };
  return cycle;
}

/** A click on a swatch, or a step of the carousel: the visitor's choice, kept. */
export function pin(cycle: Cycle, index: number): Cycle {
  const shown = wrap(index, cycle.total);
  return { ...cycle, shown, pinned: shown, mode: 'pinned' };
}

/** The studio went off screen or the tab was hidden, then came back: a full step's wait, so
 * nobody returns to a capture changing under their eyes. */
export function resume(cycle: Cycle, now: number): Cycle {
  return cycle.mode === 'auto' ? { ...cycle, nextAt: now + CYCLE_MS } : cycle;
}

/** How long until the clock needs to look again, or null when nothing is due. */
export function wait(cycle: Cycle, now: number): number | null {
  return cycle.mode === 'auto' ? Math.max(0, cycle.nextAt - now) : null;
}
