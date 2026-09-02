// Transient popover plumbing: outside-click closes, and the popover registers
// with the ui store's transient stack so Esc (the registry's app.hide) closes
// it before the window — no ad-hoc keydown listeners. Plus the placement math
// for popovers that must escape a pane: anchoredPopover() below.

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useUiStore } from "../state/ui";

/** `refs` = the popover plus its anchor (so toggling the anchor doesn't
 * close-then-reopen on the same click). */
export function useTransientPopover(
  refs: RefObject<HTMLElement | null>[],
  open: boolean,
  onClose: () => void,
): void {
  const registerTransient = useUiStore((s) => s.registerTransient);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    const unregister = registerTransient(close);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside = refsRef.current.some((r) => r.current?.contains(target));
      if (!inside) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      unregister();
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, registerTransient]);
}

// ─── anchored placement (viewport-clamped, flippable) ────────────────────────

/** The anchor's viewport rect — only the edges the placement needs. */
/** Keep a `position: fixed` popover placed against its anchor while open:
 * re-measured on its own resize (a list growing, a notice appearing), the
 * window resizing, and any ancestor scrolling under it. Returns null while
 * closed. Identity-guarded so applying `max-height` (which re-fires the
 * observer) settles instead of re-rendering forever. Three chat pickers used
 * to carry byte-identical copies of this effect (2026-09-01). */
export function useAnchoredPopoverBox(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
): AnchoredPlacement | null {
  const [box, setBox] = useState<AnchoredPlacement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const next = anchoredPopover(
        { top: anchor.top, bottom: anchor.bottom, left: anchor.left },
        // scrollHeight is the UNCAPPED height — offsetHeight would re-read the
        // cap applied last pass and never flip back
        { width: pop.offsetWidth, height: pop.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setBox((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.maxHeight === next.maxHeight &&
        current.placement === next.placement
          ? current
          : next,
      );
    };
    place();
    const observer = new ResizeObserver(place);
    if (popRef.current) observer.observe(popRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, popRef]);
  // closed = no box; the stale measurement is discarded on reopen by place()
  return open ? box : null;
}

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export interface AnchoredPlacement {
  /** Viewport coordinates for a `position: fixed` popover. */
  left: number;
  top: number;
  /** The room the chosen side actually has — apply as `max-height` so a taller
   * list scrolls INSIDE the popover instead of running off-screen. */
  maxHeight: number;
  placement: "up" | "down";
}

/** Place a popover against its anchor in VIEWPORT space, never outside it.
 *
 * A pane-relative popover is the bug this exists for: `.chat-modelpop` opened
 * upward with a `62vh` cap, so in a split (the composer sits mid-window, not at
 * the window's bottom) the list ran past the top edge and came back clipped —
 * a menu starting mid-air. The height budget has to come from the space this
 * anchor really has, not from the window's total height.
 *
 * Placement law mirrors the editor's slash menu: keep the preferred side, and
 * flip only when that side can't fit the content AND the other side has more
 * room. Ties keep the preference (no jitter at the threshold). Pure — the
 * caller feeds measured rects, so it is testable without a DOM. */
export function anchoredPopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { gap?: number; pad?: number; prefer?: "up" | "down" } = {},
): AnchoredPlacement {
  const gap = opts.gap ?? 6; // breathing room between anchor and popover
  const pad = opts.pad ?? 8; // the viewport margin the popover never crosses
  const prefer = opts.prefer ?? "up";

  const above = Math.max(0, anchor.top - gap - pad);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - pad);
  const placement: "up" | "down" =
    prefer === "up"
      ? above < size.height && below > above
        ? "down"
        : "up"
      : below < size.height && above > below
        ? "up"
        : "down";

  const maxHeight = placement === "up" ? above : below;
  const height = Math.min(size.height, maxHeight);
  const top = placement === "up" ? anchor.top - gap - height : anchor.bottom + gap;

  // horizontal clamp: prefer left-aligned with the anchor, slide in at the edges
  let left = anchor.left;
  if (left + size.width + pad > viewport.width) left = viewport.width - size.width - pad;
  if (left < pad) left = pad;

  return { left, top, maxHeight, placement };
}
