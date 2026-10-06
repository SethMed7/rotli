// A note dragged onto an open Canvas becomes a card there (2026-10-06). Drags
// in the Mac app are pointer sessions, not HTML5 drag (dead in WKWebView), so
// a canvas registers its plane here and the sidebar's drag sessions ask what
// is under the pointer before they consider Main or the panes. Pure DOM; the
// canvas decides what a drop means.

type DropNotes = (noteIds: readonly string[], clientX: number, clientY: number) => void;

const targets = new Map<HTMLElement, DropNotes>();

/** Accept dropped notes on `plane` (marked `data-canvas-drop`) until the
 * returned function is called. */
export function registerCanvasDrop(plane: HTMLElement, drop: DropNotes): () => void {
  targets.set(plane, drop);
  return () => {
    if (targets.get(plane) === drop) targets.delete(plane);
  };
}

/** The canvas under a point, if one is open there. */
export function canvasDropAt(
  x: number,
  y: number,
): { el: HTMLElement; drop: (noteIds: readonly string[]) => void } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(
    "[data-canvas-drop]",
  );
  const drop = el ? targets.get(el) : undefined;
  return el && drop ? { el, drop: (noteIds) => drop(noteIds, x, y) } : null;
}
