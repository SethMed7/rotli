// The inline Mermaid camera: scroll zooms, drag pans, a no-travel click opens
// the workspace, double-click refits. Viewports persist per source across the
// rebuilds that reveal-on-caret causes. Lifted out of blockRender.ts (its
// line ceiling) when the fit gained its own padding (2026-09-03).

import {
  type MermaidPoint,
  type MermaidViewport,
  fitMermaidViewport,
  panMermaidViewport,
  zoomMermaidViewportAt,
} from "./mermaidViewport";

// ——— the inline mermaid camera (the maintainer, 2026-07-29): scroll zooms, drag pans,
//     a no-travel click still opens the workspace. Viewports persist per
//     source across the rebuilds that reveal-on-caret causes. ———

const INLINE_VIEWPORTS = new Map<string, MermaidViewport>();
const INLINE_VIEWPORT_CAP = 100; // LRU, like embedSizeMemory — long sessions must not hoard
const INLINE_MAX_HEIGHT = 460;
const INLINE_MIN_HEIGHT = 160;
/** The card is the diagram plus this on each side; the fit pads by the same
 * amount, so a diagram that fits renders at scale 1 (the workspace's 36px
 * default left every small diagram permanently shrunk, 2026-09-03). */
export const INLINE_FIT_PADDING = 12;

/** The inline card's height for a diagram of `contentHeight` px (clamped). */
export function inlineCardHeight(contentHeight: number): number {
  return Math.max(INLINE_MIN_HEIGHT, Math.min(INLINE_MAX_HEIGHT, contentHeight + INLINE_FIT_PADDING * 2));
}

/** Fit a diagram into the inline card with the card's own padding. */
export function inlineFit(viewportSize: MermaidPoint, contentSize: MermaidPoint): MermaidViewport {
  return fitMermaidViewport(viewportSize, contentSize, INLINE_FIT_PADDING);
}

function rememberInlineViewport(code: string, viewport: MermaidViewport): void {
  INLINE_VIEWPORTS.delete(code); // re-insert = LRU touch
  INLINE_VIEWPORTS.set(code, viewport);
  while (INLINE_VIEWPORTS.size > INLINE_VIEWPORT_CAP) {
    const oldest = INLINE_VIEWPORTS.keys().next().value;
    if (oldest === undefined) break;
    INLINE_VIEWPORTS.delete(oldest);
  }
}

export interface InlineMermaidCamera {
  /** The rendered diagram landed — stage it and fit/restore the viewport. */
  mount(rendered: HTMLElement): void;
  cleanup(): void;
}

/** Gesture installation is SYNCHRONOUS (toDOM time) so click-to-open works
 * the instant the widget exists — the async mermaid render mounts into the
 * already-armed camera when it lands (a slow import must not eat clicks). */
export function createInlineMermaidCamera(
  body: HTMLElement,
  code: string,
  openWorkspace: () => void,
): InlineMermaidCamera {
  body.classList.add("rotli-mermaid-inline");
  const stage = document.createElement("div");
  stage.className = "rotli-mermaid-inline-stage";

  let rendered: HTMLElement | null = null;
  const contentSize = () => {
    const svg = rendered?.querySelector("svg");
    const box = svg?.viewBox?.baseVal;
    if (box && box.width > 0 && box.height > 0) return { x: box.width, y: box.height };
    const rect = rendered?.getBoundingClientRect();
    return { x: rect?.width || 1, y: rect?.height || 1 };
  };

  let viewport = INLINE_VIEWPORTS.get(code) ?? null;
  const apply = () => {
    if (!viewport) return;
    stage.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`;
    rememberInlineViewport(code, viewport);
  };
  const fitInline = () => {
    if (!rendered) return;
    viewport = inlineFit({ x: body.clientWidth, y: body.clientHeight }, contentSize());
    apply();
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!viewport) return;
    const rect = body.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = Math.exp(-event.deltaY * 0.0015);
    viewport = zoomMermaidViewportAt(viewport, viewport.scale * factor, anchor);
    apply();
  };
  // NON-passive on purpose: the editor scroller must not also scroll
  body.addEventListener("wheel", onWheel, { passive: false });

  let pan: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    body.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId || !viewport) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    pan.x = event.clientX;
    pan.y = event.clientY;
    if (pan.moved) {
      viewport = panMermaidViewport(viewport, { x: dx, y: dy });
      apply();
    }
  };
  const endPan = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    const wasClick = !pan.moved;
    pan = null;
    if (body.hasPointerCapture(event.pointerId)) body.releasePointerCapture(event.pointerId);
    // the promised click-to-open, only when the pointer never traveled
    if (wasClick) openWorkspace();
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (pan?.pointerId === event.pointerId) pan = null;
  };
  const onDblClick = (event: MouseEvent) => {
    event.preventDefault();
    fitInline();
  };
  body.addEventListener("pointerdown", onPointerDown);
  body.addEventListener("pointermove", onPointerMove);
  body.addEventListener("pointerup", endPan);
  body.addEventListener("pointercancel", onPointerCancel);
  body.addEventListener("dblclick", onDblClick);

  return {
    mount(el) {
      rendered = el;
      // Mermaid emits width="100%"; inside the absolutely positioned
      // (shrink-to-fit) stage that resolved to the 300px SVG default while
      // the fit math used the viewBox size, so every chart drew at ~45% and
      // off-centre (2026-09-03). Lay the SVG out at its viewBox size; the
      // stage transform is the only scaling.
      const svg = el.querySelector("svg");
      const box = svg?.viewBox?.baseVal;
      if (svg && box && box.width > 0 && box.height > 0) {
        svg.style.width = `${box.width}px`;
        svg.style.height = `${box.height}px`;
        svg.style.maxWidth = "none";
      }
      stage.replaceChildren(el);
      body.replaceChildren(stage);
      // size the viewport box to the diagram (capped), then fit or restore —
      // after layout so clientWidth is real
      requestAnimationFrame(() => {
        const size = contentSize();
        body.style.height = `${inlineCardHeight(size.y)}px`;
        if (viewport) apply();
        else fitInline();
      });
    },
    cleanup() {
      // the FULL teardown the contract promises (Greptile P2, PR #3)
      body.removeEventListener("wheel", onWheel);
      body.removeEventListener("pointerdown", onPointerDown);
      body.removeEventListener("pointermove", onPointerMove);
      body.removeEventListener("pointerup", endPan);
      body.removeEventListener("pointercancel", onPointerCancel);
      body.removeEventListener("dblclick", onDblClick);
    },
  };
}
