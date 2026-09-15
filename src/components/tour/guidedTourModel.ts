// The guided tour's steps and geometry, kept pure so the overlay component
// stays a thin renderer and the model unit-tests without a DOM.

export interface TourStep {
  id: string;
  /** Selector for the real control the step points at. */
  anchor: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "new",
    anchor: '[data-tour="new"]',
    title: "New notes start here",
    body: "This makes a Markdown note in Main. The titlebar's + also offers documents and boards.",
  },
  {
    id: "views",
    anchor: '[data-tour="views"]',
    title: "Main is a view",
    body: "Main lists the notes you reach for. Click its name to switch views or make a named view; the same file can sit in several.",
  },
  {
    id: "search",
    anchor: '[data-tour="search"]',
    title: "Find anything",
    body: "Search notes, files, chats, and actions from here, or press ⌘K anywhere.",
  },
  {
    id: "typography",
    anchor: '[data-tour="typography"]',
    title: "See the Markdown underneath",
    body: "Aa switches this note between Beautified and Raw markdown, and sets its measure and type.",
  },
  {
    id: "chat",
    anchor: '[data-tour="chat"]',
    title: "Chat lives beside your notes",
    body: "Ask about your notes with a model you choose. Secure notes never reach a remote model.",
  },
  {
    id: "settings",
    anchor: '[data-tour="settings"]',
    title: "Everything can change later",
    body: "Theme, shortcuts, window behavior, and this tour live in Settings.",
  },
];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  /** The spotlight cutout in window coordinates: the anchor plus a 2px breath. */
  hole: Rect;
  /** The one scrim's `clip-path`: the whole viewport with `hole` cut out. */
  clipPath: string;
  card: { left: number; top: number };
  /** Which side of the anchor the card sits on. */
  side: "below" | "above" | "right";
}

const PAD = 2;
const GAP = 12;

/** One full-viewport polygon with `hole` cut out. The outer ring runs
 * clockwise and the inner ring counter-clockwise, so the cutout holds under
 * nonzero (the CSS default) and evenodd filling alike. */
export function spotlightClipPath(hole: Rect, viewport: { width: number; height: number }): string {
  const left = Math.max(0, hole.left);
  const top = Math.max(0, hole.top);
  const right = Math.min(viewport.width, hole.left + hole.width);
  const bottom = Math.min(viewport.height, hole.top + hole.height);
  const at = (x: number, y: number) => `${x}px ${y}px`;
  const { width, height } = viewport;
  const outer = [at(0, 0), at(width, 0), at(width, height), at(0, height), at(0, 0)];
  const inner = [at(left, top), at(left, bottom), at(right, bottom), at(right, top), at(left, top)];
  return `polygon(${[...outer, ...inner].join(", ")})`;
}

/** Spotlight `anchor` inside a `viewport`, and place a `card` next to it:
 * below when it fits, else above, else to the right; never off-screen. */
export function placeStep(
  anchor: Rect,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): Placement {
  const hole = {
    left: anchor.left - PAD,
    top: anchor.top - PAD,
    width: anchor.width + PAD * 2,
    height: anchor.height + PAD * 2,
  };
  const clampLeft = (left: number) =>
    Math.min(Math.max(GAP, left), Math.max(GAP, viewport.width - card.width - GAP));
  let side: Placement["side"] = "below";
  let top = hole.top + hole.height + GAP;
  let left = clampLeft(hole.left);
  if (top + card.height > viewport.height - GAP) {
    side = "above";
    top = hole.top - GAP - card.height;
  }
  if (top < GAP) {
    side = "right";
    top = Math.min(Math.max(GAP, hole.top), Math.max(GAP, viewport.height - card.height - GAP));
    left = clampLeft(hole.left + hole.width + GAP);
  }
  return { hole, clipPath: spotlightClipPath(hole, viewport), card: { left, top }, side };
}

/** The next step at or after `from` whose anchor exists; -1 when none. */
export function nextAvailableStep(
  from: number,
  direction: 1 | -1,
  available: (step: TourStep) => boolean,
): number {
  for (let index = from; index >= 0 && index < TOUR_STEPS.length; index += direction) {
    const step = TOUR_STEPS[index];
    if (step && available(step)) return index;
  }
  return -1;
}
