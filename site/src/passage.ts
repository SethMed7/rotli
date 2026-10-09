// The privacy passage (site/README.md, the owner's call 2026-10-05): a section marked
// `data-passage="<environment>"` paints that environment itself (the landing's privacy band, its
// own night), locks once it fills the window, and the next section slides up over it
// (Base.astro). While the band is under the header, the header and its menus take the
// environment's tokens (Base.astro, `:root[data-passage] .site-header-bar`), and they give them
// back as soon as daylight reaches the header again, in either direction. It is a passage, not
// a preference: nothing is stored, and a reload decides afresh from where the page is.
//
// How it got here (2026-10-05 to 2026-10-08): the whole page once crossfaded into the night
// when the band filled a share of the window. Every version of that left something wrong on
// screen at the switch: a neighbour recoloured, or hidden and blank. The owner: "more of like a
// lock transition not a cross fade". Now nothing but the header changes colour, and the band's
// own edges, moving, are the transition.
//
// The decisions are pure functions so they can be tested: when the passage turns on and off,
// and how the colours travel so text stays readable in every frame of the crossfade.

export interface Span {
  top: number;
  bottom: number;
}

/**
 * Whether the passage should be on: the section's top has reached the header's line (`line`,
 * viewport coordinates) and the section after it (its top, or null when there is none) has
 * not. That is exactly while the header sits over the night.
 */
export function passageActive(section: Span, nextTop: number | null, line: number): boolean {
  if (section.bottom <= section.top) return false;
  const end = nextTop ?? section.bottom;
  return section.top <= line + 1 && end > line + 1;
}

// ——— The crossfade (Base.astro's `:root.passage-fading` rules restate these numbers) ———

/** How long the dusk (or the dawn) takes. Reduced motion switches at once. */
export const PASSAGE_MS = 700;
/** The grounds (page, surfaces, borders) ease slowly out, cross quickly, and settle slowly. */
export const GROUND_EASE = [0.65, 0, 0.35, 1] as const;
/** Text never fades through the ground (a colour on its way from dark to light must cross a
 * ground on its way from light to dark, and there it vanishes): it switches whole at this
 * share of the crossfade, when the grounds are mid-tone and both inks read alike (just past
 * halfway, where the page ground and the lighter night surfaces balance best). */
export const INK_AT = 0.51;
/** Muted and accent text lean all the way onto the main text colour around the switch, so they
 * hold its contrast while the ground is mid-tone, and settle back after: [share, lean]. */
export const LEAN_KEYS = [
  [0, 0],
  [0.3, 1],
  [0.7, 1],
  [1, 0],
] as const;

/** CSS's cubic-bezier timing function: progress (0–1) for elapsed time share (0–1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/** The lean of muted and accent text toward the main text colour at time share `t`. */
export function leanAt(t: number): number {
  for (let i = 1; i < LEAN_KEYS.length; i++) {
    const [t0, v0] = LEAN_KEYS[i - 1];
    const [t1, v1] = LEAN_KEYS[i];
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
  }
  return 0;
}

type Rgb = readonly [number, number, number];

export function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB interpolation, as browsers transition colours and as `color-mix(in srgb, …)` mixes. */
export function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** WCAG 2 contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: Rgb) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A text token and the ground it sits on, in the day and in the night. A text token that
 * leans onto the main text colour around the switch (muted, accent) names it as `main`. */
export interface PassagePair {
  text: readonly [string, string];
  ground: readonly [string, string];
  main?: readonly [string, string];
}

/** The text and ground colours a pair shows at time share `t` of the crossfade into the night
 * (the way back out is the same path in reverse). */
export function passageFrame(pair: PassagePair, t: number): { text: Rgb; ground: Rgb } {
  const ease = cubicBezier(...GROUND_EASE);
  const night = t >= INK_AT ? 1 : 0;
  const ground = mix(rgb(pair.ground[0]), rgb(pair.ground[1]), ease(t));
  const rest = rgb(pair.text[night]);
  const text = pair.main ? mix(rest, rgb(pair.main[night]), leanAt(t)) : rest;
  return { text, ground };
}

/** How long the root keeps its transitions after a switch: the crossfade and a little more. */
const FADE_MS = PASSAGE_MS + 100;

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
  const header = doc.querySelector<HTMLElement>('.site-header-bar');
  // Each passage and the section that slides over it (a component's script can sit between).
  const after = new Map<HTMLElement, HTMLElement | null>();
  for (const section of sections) {
    let next = section.nextElementSibling;
    while (next && next.tagName !== 'SECTION') next = next.nextElementSibling;
    after.set(section, next as HTMLElement | null);
  }
  // The band locks with its end on the window's end when it is taller than the window, so it
  // needs its own height (Base.astro, --passage-h).
  const measure = () => sections.forEach((section) => section.style.setProperty('--passage-h', `${section.offsetHeight}px`));
  if ('ResizeObserver' in window) {
    const sizes = new ResizeObserver(measure);
    sections.forEach((section) => sizes.observe(section));
  }
  measure();

  const apply = (next: HTMLElement | null) => {
    if (next === current) return;
    current = next;
    // A switch during a switch starts the lean of muted text over (one forced style read,
    // only then, never on scroll).
    if (root.classList.contains('passage-fading')) {
      root.classList.remove('passage-fading');
      void root.offsetWidth;
    }
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
    const line = header?.getBoundingClientRect().bottom ?? 0;
    let next: HTMLElement | null = null;
    for (const section of sections) {
      const box = section.getBoundingClientRect();
      const nextTop = after.get(section)?.getBoundingClientRect().top ?? null;
      if (passageActive(box, nextTop, line)) {
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
  window.clearTimeout(fadeTimer);
  root.classList.remove('passage-fading');
}
