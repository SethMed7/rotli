// Where a context menu opens. It grows right and down from the pointer, like
// every Mac menu — and when there is no room on a side it FLIPS to the other
// side of the pointer instead of being shoved along the window's edge. The
// shove put the menu on top of the row that was clicked, pointer already over
// an item; with the sidebar on the right that was every right-click in it (the
// owner, 2026-09-18). Only a menu larger than the space on BOTH sides is
// clamped. Pure.

export interface MenuPlacement {
  left: number;
  top: number;
}

function along(pointer: number, size: number, viewport: number, pad: number): number {
  if (pointer + size + pad <= viewport) return pointer; // room after the pointer
  if (pointer - size >= pad) return pointer - size; // flip: end AT the pointer
  return Math.max(pad, viewport - size - pad); // neither side fits: keep it on screen
}

export function placeMenu(
  pointer: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  pad = 8,
): MenuPlacement {
  return {
    left: along(pointer.x, size.width, viewport.width, pad),
    top: along(pointer.y, size.height, viewport.height, pad),
  };
}
