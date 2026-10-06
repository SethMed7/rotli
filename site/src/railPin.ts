// Where a blog post's left rail is pinned (blog/ArticleRail.astro). It is sticky, and this picks
// its `top`. When all of it fits under the header (with a margin above and below), it is pinned
// there. When it does not (a short window, or every source open), it moves with the page as the
// page scrolls, by the same amount, until its foot is in view on the way down or its head on the
// way up, and holds there: every part of it is reachable by scrolling a little either way, and
// nothing in it ever scrolls inside itself or is cut off. Pure, so it is unit-tested
// (scripts/site-interactions.test.ts); the rail's script wires it to the page.

export interface RailRoom {
  /** The header's bottom edge, in viewport pixels. */
  headerBottom: number;
  /** The window's height. */
  viewport: number;
  /** The rail's own height. */
  height: number;
  /** The space kept above and below it. */
  margin: number;
}

export interface RailBounds {
  /** `top` that shows its head: just under the header. */
  max: number;
  /** `top` that shows its foot: the margin above the window's bottom (never more than `max`). */
  min: number;
  /** All of it fits, so it is simply pinned under the header. */
  fits: boolean;
}

export function railBounds(room: RailRoom): RailBounds {
  const max = room.headerBottom + room.margin;
  const foot = room.viewport - room.height - room.margin;
  return { max, min: Math.min(max, foot), fits: foot >= max };
}

/** The next `top`: the last one moved by how far the page scrolled (down is positive), kept
 * between showing the foot and showing the head. */
export function railTop(previous: number, scrolledBy: number, bounds: RailBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, previous - scrolledBy));
}
