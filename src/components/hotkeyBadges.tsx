// HotkeyBadges — "hold ⌘ and the keys appear ON the controls" (the maintainer,
// 2026-08-04: "little boxes on what the hotkeys are around the UI so I can
// visually see and instantly toggle exactly where I want to go").
//
// The badge alternative to WhichKey's grouped panel: instead of a list you must
// read and translate back to the UI, each chord is pinned to the control it
// actually drives. Same law as WhichKey — READ-ONLY over the registry
// (currentChord / formatChord), pointer-events:none, aria-hidden, and NO
// keydown listeners of its own. Pressing the chord fires through the ONE
// dispatcher exactly as it always did; this layer only shows what is already
// true (docs/development/adding-things.md, the keys law).
//
// Elements opt in by tagging themselves `data-hotkey="<action id>"` — no props,
// no context, no registry of coordinates to keep in sync. Anything with the
// attribute that is on screen and currently bound gets a badge.

import { useLayoutEffect, useState } from "react";

import { formatChord } from "../keys/chords";
import { currentChord } from "../keys/registry";

/** The attribute a control tags itself with to earn a badge. */
export const HOTKEY_ATTR = "data-hotkey";

export interface BadgeSpot {
  id: string;
  /** The Mac-symbol chord, already formatted (e.g. "⌃1"). */
  chord: string;
  left: number;
  top: number;
  /** True when the anchored control is the current pressed/selected choice. */
  active: boolean;
}

export interface BadgeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Is this rect worth badging — on screen, and big enough to anchor to? A
 * display:none control measures 0×0; a scrolled-away one lands off-viewport.
 * Pure + exported for tests. */
export function rectIsBadgeable(rect: BadgeRect, viewport: { width: number; height: number }): boolean {
  if (rect.width < 8 || rect.height < 8) return false;
  if (rect.left + rect.width < 0 || rect.top + rect.height < 0) return false;
  return rect.left < viewport.width && rect.top < viewport.height;
}

/** The portion of a control that can really paint through all clipping
 * ancestors. A fixed overlay does not inherit overflow clipping, so its badge
 * must use this intersection explicitly. */
export function visibleBadgeRect(
  rect: BadgeRect,
  clips: readonly BadgeRect[],
  viewport: { width: number; height: number },
): BadgeRect {
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(viewport.width, rect.left + rect.width);
  let bottom = Math.min(viewport.height, rect.top + rect.height);
  for (const clip of clips) {
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.left + clip.width);
    bottom = Math.min(bottom, clip.top + clip.height);
  }
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** Collect the badge spots for the tagged elements currently on screen. Kept
 * pure over its inputs (the elements + a chord lookup) so the placement rules
 * are testable without a DOM. Badges anchor to the control's TOP-LEFT, nudged
 * inward so they read as sitting ON the control rather than beside it. */
export function collectSpots(
  elements: readonly {
    id: string;
    rect: BadgeRect;
    /** Visible boxes of overflow-clipping ancestors, nearest first. */
    clips?: readonly BadgeRect[];
    active?: boolean;
  }[],
  viewport: { width: number; height: number },
  chordOf: (id: string) => string | null,
): BadgeSpot[] {
  const seen = new Set<string>();
  const out: BadgeSpot[] = [];
  for (const el of elements) {
    // one badge per ACTION — a control rendered twice (a footer echoed in a
    // menu) would otherwise stack duplicate badges on the same chord
    if (seen.has(el.id)) continue;
    const visibleRect = visibleBadgeRect(el.rect, el.clips ?? [], viewport);
    if (!rectIsBadgeable(visibleRect, viewport)) continue;
    const chord = chordOf(el.id);
    if (!chord) continue; // unbound → nothing to teach
    seen.add(el.id);
    out.push({
      id: el.id,
      chord: formatChord(chord),
      left: Math.max(2, visibleRect.left + 2),
      top: Math.max(2, visibleRect.top + 2),
      active: el.active ?? false,
    });
  }
  return out;
}

export function HotkeyBadges() {
  const [spots, setSpots] = useState<BadgeSpot[]>([]);

  // Measure ONCE on mount: the overlay only exists while ⌘ is held idle, and
  // the hook drops it the instant anything happens — so nothing can move under
  // it. useLayoutEffect so badges paint with the overlay, never a frame late.
  useLayoutEffect(() => {
    const tagged = [...document.querySelectorAll<HTMLElement>(`[${HOTKEY_ATTR}]`)];
    const elements = tagged.flatMap((node) => {
      const id = node.getAttribute(HOTKEY_ATTR);
      if (!id) return [];
      const r = node.getBoundingClientRect();
      const clips: BadgeRect[] = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = window.getComputedStyle(parent);
        const clipsOverflow = [style.overflowX, style.overflowY].some((overflow) =>
          ["auto", "clip", "hidden", "scroll"].includes(overflow),
        );
        if (!clipsOverflow) continue;
        const parentRect = parent.getBoundingClientRect();
        clips.push({
          left: parentRect.left + parent.clientLeft,
          top: parentRect.top + parent.clientTop,
          width: parent.clientWidth,
          height: parent.clientHeight,
        });
      }
      return [
        {
          id,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          clips,
          active:
            node.getAttribute("aria-pressed") === "true" || node.getAttribute("aria-selected") === "true",
        },
      ];
    });
    setSpots(collectSpots(elements, { width: window.innerWidth, height: window.innerHeight }, currentChord));
  }, []);

  if (spots.length === 0) return null;
  return (
    <div className="hkbadges" role="presentation" aria-hidden="true">
      {spots.map((spot) => (
        <kbd
          className={spot.active ? "hkbadge on-active" : "hkbadge"}
          key={spot.id}
          style={{ left: spot.left, top: spot.top }}
        >
          {spot.chord}
        </kbd>
      ))}
    </div>
  );
}
