// The tour's scroll steps ("A closer look.", landing/Tour.astro; the owner, 2026-10-05: "make
// this work with the scroll"). On wide screens the list and the preview are pinned while a
// tall runway of per-part anchors scrolls behind them; the part whose anchor crosses a line
// across the middle of the window is the one shown. It switches by step, never scrubs: the
// preview crossfades from one part to the next, and nothing moves between steps.
//
// A click on a part scrolls the page to that part's step. While that scroll is in flight the
// line passes over the parts in between, so the clicked part is held as the visitor's intent
// until the line reaches it, or the scroll ends (the visitor may stop it short with the wheel).
//
// No DOM here, so the rules can be tested (scripts/site-interactions.test.ts).

/** Where the line that picks the shown part sits, as a share of the window's height. */
export const LINE_SHARE = 0.5;

/** How long a click's intent holds if the browser never says the scroll ended, in ms. */
export const INTENT_MS = 1400;

export interface Span {
  top: number;
  bottom: number;
}

/** The part whose anchor holds the line. Above the first anchor it is the first part; past the
 * last, the last. Anchors are in page order and touch, so exactly one holds any line between. */
export function stepAt(anchors: readonly Span[], line: number): number {
  if (anchors.length === 0) return 0;
  let step = 0;
  for (let i = 0; i < anchors.length; i++) if (anchors[i].top <= line) step = i;
  return step;
}

/** The scroll position that puts the middle of a part's anchor on the line. `anchor` is in page
 * coordinates (its top with the scroll added back), `line` in window coordinates. */
export function stepScrollY(anchor: Span, line: number): number {
  return Math.max(0, Math.round((anchor.top + anchor.bottom) / 2 - line));
}

export interface Follow {
  /** The part on show. */
  shown: number;
  /** A clicked part the page is scrolling to, or null when the scroll leads. */
  intent: number | null;
}

export function createFollow(): Follow {
  return { shown: 0, intent: null };
}

/** The line moved. With no intent the scroll leads; with one, the shown part waits for the line
 * to reach it, so a smooth scroll past other parts doesn't flash their previews. */
export function follow(state: Follow, step: number): Follow {
  if (state.intent === null) return step === state.shown ? state : { shown: step, intent: null };
  return step === state.intent ? { shown: step, intent: null } : state;
}

/** A click (or Enter, or Space) on a part: shown at once, held as the intent. */
export function choose(step: number): Follow {
  return { shown: step, intent: step };
}

/** The scroll ended, or the intent's time ran out: wherever the line is now leads again. */
export function settle(step: number): Follow {
  return { shown: step, intent: null };
}
