// The landing's three steps follow the scroll (Overview.astro; the owner, 2026-10-08: "make
// the switches of what I am looking at happen with scroll not manually"). While the story is
// pinned under the header, the page scrolls through a runway below it, and the runway's share
// that has gone by picks the step: the first third shows Write, the second File, the last Ask.
// A step switches whole, with the picture sliding in; nothing is scrubbed along with the scroll.
//
// No DOM here, so the mapping can be tested (scripts/site-interactions.test.ts).

/** How much page scroll each step after the first gets, as a share of the window's height. */
export const STEP_RUNWAY = 0.5;

/** How far through the runway the page is (0 to 1): the pin's top (viewport coordinates), where
 * the story sticks, and the runway's length. */
export function runwayProgress(pinTop: number, stickAt: number, runway: number): number {
  if (runway <= 0) return 0;
  return Math.min(1, Math.max(0, (stickAt - pinTop) / runway));
}

/** The step on show at a given progress, for `steps` steps, each holding an equal share. */
export function stepAt(progress: number, steps: number): number {
  if (steps < 1) return 0;
  return Math.min(steps - 1, Math.max(0, Math.floor(progress * steps)));
}

/** The progress that sits a step in the middle of its share (where a tab scrolls the page to). */
export function progressFor(step: number, steps: number): number {
  return (step + 0.5) / steps;
}
