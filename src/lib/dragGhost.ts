// The floating drag ghost (the maintainer, 2026-07-01: "when I am dragging something it
// should literally come with me"). ONE implementation for every pointer drag —
// tabs (tabDrag), the Main tree move/add (Sidebar), Board cards (BoardSurface),
// note images (livePreview's ImgWidget, the image variant below).
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

function mountGhost(el: HTMLElement, x: number, y: number): DragGhost {
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

export function createDragGhost(label: string, x: number, y: number): DragGhost {
  const el = document.createElement("div");
  el.className = "drag-ghost";
  el.textContent = label;
  return mountGhost(el, x, y);
}

/** The image variant: the picked-up image itself follows the pointer — a small
 * lifted clone, not a text chip. Same contract, same exit-path law. */
export function createImageDragGhost(source: HTMLImageElement, x: number, y: number): DragGhost {
  const el = document.createElement("div");
  el.className = "drag-ghost img";
  const img = document.createElement("img");
  img.src = source.src;
  img.alt = "";
  img.draggable = false;
  el.appendChild(img);
  return mountGhost(el, x, y);
}
