// The ONE pointer-drag session (remediation Batch 4, F4) — tab drags (tabDrag),
// Main add-drags (mainAddDrag), Board card reorder (BoardSurface) and the Main
// tree move/add (Sidebar) had each retyped the same gesture skeleton. Pointer
// events, not HTML5 DnD, because HTML5 drag is dead in the macOS WKWebView (wry)
// shell. The session owns the mechanics only: the left-button guard, the
// press→drag threshold, painting/moving/destroying the floating ghost, the four
// window listeners (pointermove / pointerup / pointercancel / capture keydown
// for Esc) and their teardown on EVERY exit path, and the optional trailing
// click swallow. Everything semantic — hit-testing, drop targets, previews,
// commits — stays in the caller's closures via the callbacks below.

import type { PointerEvent as ReactPointerEvent } from "react";

import type { DragGhost } from "./dragGhost";

/** Manhattan travel that turns a press into a drag — the shared default. */
const DEFAULT_THRESHOLD_PX = 5;

/** How long the post-drag click swallow stays armed if no click arrives. */
const SWALLOW_MS = 60;

export interface PointerDragOptions {
  /** Paint the floating ghost the moment real travel starts; the session moves
   * it on every pointermove and destroys it on every exit path. */
  ghost: (x: number, y: number) => DragGhost;
  /** Manhattan distance (|dx| + |dy|, px) that starts the drag. Default 5. */
  thresholdPx?: number;
  /** Site override for the start test (dx/dy are travel from the press). Wins
   * over thresholdPx — for sites whose historical feel isn't the Manhattan sum. */
  passedThreshold?: (dx: number, dy: number) => boolean;
  /** Fires ONCE when the threshold is crossed, before that move's onMove. */
  onStart?: (x: number, y: number) => void;
  /** Every pointermove after the drag began (including the starting one), after
   * the ghost has followed — hit-test and stage the drop target here. */
  onMove: (x: number, y: number) => void;
  /** Pointerup after a real drag — commit here. Runs BEFORE teardown/onEnd, so
   * a commit may still read state that onEnd clears (tabDrag's dropPreview). */
  onDrop?: () => void;
  /** Every exit path — drop, plain click (no travel), Esc, pointercancel —
   * after the ghost is destroyed and the listeners are gone. Reset site state. */
  onEnd?: () => void;
  /** Swallow the click that trails a real drag (capture, once, 60ms window) so
   * the pressed element's onClick doesn't also fire. Sites that suppress via a
   * did-drag ref instead leave this off. */
  swallowClick?: boolean;
}

/** Begin tracking a possible drag from an element's pointerdown. A plain click
 * (no travel) tears down without onStart/onDrop, so it falls through to the
 * element's own click handling. */
export function createPointerDragSession(event: ReactPointerEvent, opts: PointerDragOptions): void {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const threshold = opts.thresholdPx ?? DEFAULT_THRESHOLD_PX;
  const passedThreshold =
    opts.passedThreshold ?? ((dx: number, dy: number) => Math.abs(dx) + Math.abs(dy) >= threshold);
  let dragging = false;
  let ghost: DragGhost | null = null;

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (!passedThreshold(e.clientX - startX, e.clientY - startY)) return;
      dragging = true;
      ghost = opts.ghost(e.clientX, e.clientY);
      opts.onStart?.(e.clientX, e.clientY);
    }
    ghost?.move(e.clientX, e.clientY);
    opts.onMove(e.clientX, e.clientY);
  };

  // every exit path (drop, plain click, Esc, pointercancel) tears the same
  // things down; only onUp commits
  const teardown = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", teardown);
    window.removeEventListener("keydown", onKey, true);
    ghost?.destroy();
    ghost = null;
    opts.onEnd?.();
  };

  const onUp = (e: PointerEvent) => {
    const wasDragging = dragging;
    if (wasDragging) {
      // hit-test once more at the release point: rows can shift under a still
      // pointer after the last pointermove (the drag's own first re-render, a
      // smooth scroll settling), and the commit must match what is under it NOW
      if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) opts.onMove(e.clientX, e.clientY);
      opts.onDrop?.();
    }
    teardown();
    if (wasDragging && opts.swallowClick) {
      // swallow the click that fires after a drag so the pressed element
      // doesn't also activate on drop
      const swallow = (ce: MouseEvent) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), SWALLOW_MS);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      teardown();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", teardown);
  window.addEventListener("keydown", onKey, true);
}
