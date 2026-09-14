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
  /** The four scrim panels around the spotlight, in window coordinates. */
  scrims: Rect[];
  ring: Rect;
  card: { left: number; top: number };
  /** Which side of the anchor the card sits on. */
  side: "below" | "above" | "right";
}

const PAD = 6;
const GAP = 12;

/** Spotlight `anchor` inside a `viewport`, and place a `card` next to it:
 * below when it fits, else above, else to the right; never off-screen. */
export function placeStep(
  anchor: Rect,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): Placement {
  const ring = {
    left: anchor.left - PAD,
    top: anchor.top - PAD,
    width: anchor.width + PAD * 2,
    height: anchor.height + PAD * 2,
  };
  const scrims: Rect[] = [
    { left: 0, top: 0, width: viewport.width, height: Math.max(0, ring.top) },
    {
      left: 0,
      top: ring.top + ring.height,
      width: viewport.width,
      height: Math.max(0, viewport.height - ring.top - ring.height),
    },
    { left: 0, top: ring.top, width: Math.max(0, ring.left), height: ring.height },
    {
      left: ring.left + ring.width,
      top: ring.top,
      width: Math.max(0, viewport.width - ring.left - ring.width),
      height: ring.height,
    },
  ];
  const clampLeft = (left: number) =>
    Math.min(Math.max(GAP, left), Math.max(GAP, viewport.width - card.width - GAP));
  let side: Placement["side"] = "below";
  let top = ring.top + ring.height + GAP;
  let left = clampLeft(ring.left);
  if (top + card.height > viewport.height - GAP) {
    side = "above";
    top = ring.top - GAP - card.height;
  }
  if (top < GAP) {
    side = "right";
    top = Math.min(Math.max(GAP, ring.top), Math.max(GAP, viewport.height - card.height - GAP));
    left = clampLeft(ring.left + ring.width + GAP);
  }
  return { scrims, ring, card: { left, top }, side };
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
