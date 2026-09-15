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
  opts: PopoverOptions = {},
): AnchoredPlacement | null {
  const [box, setBox] = useState<AnchoredPlacement | null>(null);
  const { prefer, maxHeight, gap, pad, flipSide } = opts;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const next = anchoredPopover(
        { top: anchor.top, bottom: anchor.bottom, left: anchor.left, right: anchor.right },
        // scrollHeight is the UNCAPPED height — offsetHeight would re-read the
        // cap applied last pass and never flip back
        { width: pop.offsetWidth, height: pop.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { prefer, maxHeight, gap, pad, flipSide },
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
  }, [open, anchorRef, popRef, prefer, maxHeight, gap, pad, flipSide]);
  // closed = no box; the stale measurement is discarded on reopen by place()
  return open ? box : null;
}

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type PopoverPlacement = "up" | "down" | "left" | "right";

export interface PopoverOptions {
  /** Breathing room between anchor and popover (default 6). */
  gap?: number | undefined;
  /** The viewport margin the popover never crosses (default 8). */
  pad?: number | undefined;
  /** The side to keep when it fits (default "up"). */
  prefer?: PopoverPlacement | undefined;
  /** Cap the popover's own height before any side is judged — a long list
   * capped at 360px fits beside its anchor where its full height would not. */
  maxHeight?: number | undefined;
  /** For a side preference: may it flip to the opposite side (default true)?
   * false goes straight to up/down when the preferred side can't fit. */
  flipSide?: boolean | undefined;
}

export interface AnchoredPlacement {
  /** Viewport coordinates for a `position: fixed` popover. */
  left: number;
  top: number;
  /** The room the chosen side actually has — apply as `max-height` so a taller
   * list scrolls INSIDE the popover instead of running off-screen. */
  maxHeight: number;
  placement: PopoverPlacement;
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
 * room. Ties keep the preference (no jitter at the threshold). The same law
 * governs a SIDE preference ("right"/"left" — the composer's model chip): keep
 * it, flip to the other side when it can't fit and that side is roomier, and
 * when neither side fits the width fall through to the vertical law. A side
 * popover is bottom-aligned with its anchor and clamped to the window's
 * height. Pure — the caller feeds measured rects, so it is testable without a
 * DOM. */
export function anchoredPopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: PopoverOptions = {},
): AnchoredPlacement {
  const gap = opts.gap ?? 6;
  const pad = opts.pad ?? 8;
  const prefer = opts.prefer ?? "up";
  const wanted = opts.maxHeight === undefined ? size.height : Math.min(size.height, opts.maxHeight);

  if (prefer === "left" || prefer === "right") {
    const side = sidePlacement(anchor, size.width, viewport.width, prefer, gap, pad, opts.flipSide ?? true);
    if (side) {
      const room = Math.max(0, viewport.height - pad * 2);
      const maxHeight = opts.maxHeight === undefined ? room : Math.min(room, opts.maxHeight);
      const height = Math.min(wanted, maxHeight);
      // bottom-aligned with the anchor, then kept inside the window
      let top = anchor.bottom - height;
      if (top + height + pad > viewport.height) top = viewport.height - pad - height;
      if (top < pad) top = pad;
      const left = side === "right" ? anchor.right + gap : anchor.left - gap - size.width;
      return { left, top, maxHeight, placement: side };
    }
  }

  const vertical: "up" | "down" = prefer === "down" ? "down" : "up";
  const above = Math.max(0, anchor.top - gap - pad);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - pad);
  const placement: "up" | "down" =
    vertical === "up"
      ? above < wanted && below > above
        ? "down"
        : "up"
      : below < wanted && above > below
        ? "up"
        : "down";

  const room = placement === "up" ? above : below;
  const maxHeight = opts.maxHeight === undefined ? room : Math.min(room, opts.maxHeight);
  const height = Math.min(wanted, maxHeight);
  const top = placement === "up" ? anchor.top - gap - height : anchor.bottom + gap;

  // horizontal clamp: prefer left-aligned with the anchor, slide in at the edges
  let left = anchor.left;
  if (left + size.width + pad > viewport.width) left = viewport.width - size.width - pad;
  if (left < pad) left = pad;

  return { left, top, maxHeight, placement };
}

/** Which side (if any) a popover of `width` can take beside the anchor. Same
 * keep-the-preference law as up/down; null when neither side fits. */
function sidePlacement(
  anchor: AnchorRect,
  width: number,
  viewportWidth: number,
  prefer: "left" | "right",
  gap: number,
  pad: number,
  flip: boolean,
): "left" | "right" | null {
  const roomRight = Math.max(0, viewportWidth - anchor.right - gap - pad);
  const roomLeft = Math.max(0, anchor.left - gap - pad);
  const fitsRight = roomRight >= width;
  const fitsLeft = roomLeft >= width;
  if (!flip) return (prefer === "right" ? fitsRight : fitsLeft) ? prefer : null;
  if (!fitsRight && !fitsLeft) return null;
  if (prefer === "right") return fitsRight || roomRight >= roomLeft ? "right" : "left";
  return fitsLeft || roomLeft >= roomRight ? "left" : "right";
}
