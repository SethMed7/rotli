// The floating drag ghost (Seth, 2026-07-01: "when I am dragging something it
// should literally come with me"). ONE implementation for every pointer drag —
// tabs (tabDrag), the Main tree move/add (Sidebar), Board cards (BoardSurface).
// A fixed-position <div> the drag moves imperatively on each pointermove; the
// .drag-ghost class is pointer-events:none, so the drags' elementFromPoint
// hit-tests pass straight through it. Owners MUST destroy() on every exit path
// (pointerup, pointercancel, Esc) or the ghost outlives the gesture.

export interface DragGhost {
  /** Follow the pointer — call from the drag's pointermove. */
  move(x: number, y: number): void;
  /** Remove from the DOM. Safe to call twice (exit paths can overlap). */
  destroy(): void;
}

export function createDragGhost(label: string, x: number, y: number): DragGhost {
  const el = document.createElement("div");
  el.className = "drag-ghost";
  el.textContent = label;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  return {
    move(nx: number, ny: number) {
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
    },
    destroy() {
      el.remove();
    },
  };
}
