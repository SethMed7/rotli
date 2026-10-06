// The privacy passage (site/README.md, the owner's call 2026-10-05): while a section marked
// `data-passage="<environment>"` is the focal passage of the window, the whole page, header
// and menus included, takes that environment's tokens (Base.astro, `:root[data-passage]`), and
// it gives them back the moment the visitor leaves the section in either direction. It is a
// passage, not a preference: nothing is stored, and a reload decides afresh from where the
// page is.
//
// The decision is one pure function so it can be tested: a focal line across the middle of
// the window, and a margin of hysteresis on both edges, so a page resting near a boundary
// never flickers between the two environments.

export interface Span {
  top: number;
  bottom: number;
}

/** Where the focal line sits, as a share of the window's height from the top. */
export const FOCAL_LINE = 0.5;
/** How far past an edge the line must travel to switch, as a share of the window's height. */
export const HYSTERESIS = 0.08;

/**
 * Whether the passage should be on, given the section's box (viewport coordinates), the
 * window's height, and whether it is on now. It turns on once the focal line is inside the
 * section by the margin, and off once the line is outside it by the margin; between the two
 * it keeps its current state.
 */
export function passageActive(section: Span, viewportHeight: number, active: boolean): boolean {
  if (viewportHeight <= 0 || section.bottom <= section.top) return false;
  const line = viewportHeight * FOCAL_LINE;
  const margin = viewportHeight * HYSTERESIS;
  // A section shorter than both margins together could never satisfy the "on" test.
  const inset = Math.min(margin, (section.bottom - section.top) / 4);
  if (active) return !(section.top > line + inset || section.bottom < line - inset);
  return section.top <= line - inset && section.bottom >= line + inset;
}

/** How long the page keeps its color transitions on around a switch. */
const FADE_MS = 900;

/**
 * Wires every `[data-passage]` section on the page to the root element. Scroll and resize
 * work is batched into one frame; with no such section this does nothing at all.
 */
export function watchPassages(doc: Document = document): void {
  const sections = [...doc.querySelectorAll<HTMLElement>('[data-passage]')];
  if (sections.length === 0) return;
  const root = doc.documentElement;
  const themeColor = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const restingThemeColor = themeColor?.content ?? '';
  let current: HTMLElement | null = null;
  let frame = 0;
  let fadeTimer = 0;

  const apply = (next: HTMLElement | null) => {
    if (next === current) return;
    current = next;
    root.classList.add('passage-fading');
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => root.classList.remove('passage-fading'), FADE_MS);
    if (next) {
      root.dataset.passage = next.dataset.passage ?? '';
      if (themeColor) themeColor.content = next.dataset.passageColor ?? restingThemeColor;
    } else {
      delete root.dataset.passage;
      if (themeColor) themeColor.content = restingThemeColor;
    }
  };

  const update = () => {
    frame = 0;
    const height = window.innerHeight;
    let next: HTMLElement | null = null;
    for (const section of sections) {
      const box = section.getBoundingClientRect();
      if (passageActive(box, height, section === current)) {
        next = section;
        break;
      }
    }
    apply(next);
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  // A reload mid-page (or a jump to #privacy) lands in the right environment at once.
  update();
  root.classList.remove('passage-fading');
}
