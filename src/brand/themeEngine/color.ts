// Colour maths for the custom-theme engine: strict hex parsing, OKLCH, and
// WCAG 2.x contrast on the final 8-bit colour. Pure; no DOM.

export type Rgb = readonly [number, number, number];
export interface Lch {
  l: number;
  c: number;
  h: number;
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const map3 = (v: Rgb, f: (ch: number, i: number) => number): Rgb => [f(v[0], 0), f(v[1], 1), f(v[2], 2)];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` or `#rrggbb` to channels in 0..1. Anything else is not a colour,
 * so a string from a file can never reach CSS as text. */
export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const match = HEX.exec(value.trim());
  if (!match?.[1]) return null;
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((ch) => ch + ch).join("");
  return map3([0, 2, 4], (i) => Number.parseInt(digits.slice(i, i + 2), 16) / 255);
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((ch) =>
      Math.round(clamp(ch, 0, 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The canonical `#rrggbb` spelling of a colour, or null. */
export function normHex(value: unknown): string | null {
  const rgb = parseHex(value);
  return rgb ? toHex(rgb) : null;
}

const toLinear = (ch: number): number => (ch <= 0.04045 ? ch / 12.92 : ((ch + 0.055) / 1.055) ** 2.4);
const toGamma = (ch: number): number => (ch <= 0.0031308 ? 12.92 * ch : 1.055 * ch ** (1 / 2.4) - 0.055);

function linearToOklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([lightness, a, b]: Rgb): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** A hex colour in OKLCH (hue in degrees; 0 for a neutral). */
export function toLch(hex: string): Lch {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const [l, a, b] = linearToOklab(map3(rgb, toLinear));
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h: c < 1e-4 ? 0 : h };
}

function lchToLinear({ l, c, h }: Lch): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear([l, c * Math.cos(rad), c * Math.sin(rad)]);
}

const inGamut = (rgb: Rgb): boolean => rgb.every((ch) => ch >= -1e-4 && ch <= 1 + 1e-4);

/** OKLCH to hex. Out of gamut, a colour keeps its lightness and hue and gives
 * up chroma. */
export function fromLch({ l, c, h }: Lch): string {
  const lightness = clamp(l, 0, 1);
  let rgb = lchToLinear({ l: lightness, c, h });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchToLinear({ l: lightness, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    rgb = lchToLinear({ l: lightness, c: lo, h });
  }
  return toHex(map3(rgb, (ch) => toGamma(clamp(ch, 0, 1))));
}

/** WCAG relative luminance. An unreadable colour measures as black. */
export function luminance(hex: string): number {
  const [r, g, b] = map3(parseHex(hex) ?? [0, 0, 0], toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colours, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `fg` at `alpha` painted over `bg`, the way `rgba()` and
 * `color-mix(in srgb, fg N%, transparent)` composite: in gamma sRGB. */
export function over(fg: string, alpha: number, bg: string): string {
  const f = parseHex(fg) ?? [0, 0, 0];
  const b = parseHex(bg) ?? [0, 0, 0];
  return toHex(map3(f, (ch, i) => ch * alpha + (b[i] ?? 0) * (1 - alpha)));
}

/** `color-mix(in srgb, a p%, b)` with p in 0..1. */
export const mix = (a: string, p: number, b: string): string => over(a, p, b);
