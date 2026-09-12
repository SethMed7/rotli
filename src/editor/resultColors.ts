// The named colors a result or toggle label may carry (`[Label:color]`),
// in rainbow order for the picker. One list, two consumers: the parser accepts
// exactly these names and the picker offers exactly these names.

export const RESULT_COLOR_NAMES = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
  "brown",
  "black",
  "white",
  "neutral",
  "accent",
] as const;

export type ResultColorName = (typeof RESULT_COLOR_NAMES)[number];
export type ResultColor = ResultColorName | `#${string}`;

export const RESULT_HEX_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

export function isResultColorName(value: string): value is ResultColorName {
  return (RESULT_COLOR_NAMES as readonly string[]).includes(value);
}

/** Per name: the semantic token behind it (so every theme tunes it) and the
 * ink that reads on it when the option is pressed. */
const NAMED: Record<ResultColorName, { value: string; ink: string }> = {
  red: { value: "var(--failure)", ink: "var(--on-accent)" },
  orange: { value: "var(--accent-swatch-orange)", ink: "var(--rotli-cocoa)" },
  yellow: { value: "var(--accent-swatch-amber)", ink: "var(--rotli-cocoa)" },
  green: { value: "var(--success)", ink: "var(--check-ink)" },
  cyan: { value: "var(--accent-swatch-cyan)", ink: "var(--rotli-cocoa)" },
  blue: { value: "var(--accent-swatch-blue)", ink: "var(--on-accent)" },
  purple: { value: "var(--accent-swatch-violet)", ink: "var(--on-accent)" },
  pink: { value: "var(--accent-swatch-rose)", ink: "var(--on-accent)" },
  brown: { value: "var(--accent-swatch-brown)", ink: "var(--rotli-linen)" },
  black: { value: "var(--accent-swatch-black)", ink: "var(--rotli-linen)" },
  white: { value: "var(--accent-swatch-white)", ink: "var(--rotli-cocoa)" },
  neutral: { value: "var(--text-muted)", ink: "var(--surface)" },
  accent: { value: "var(--accent)", ink: "var(--on-accent)" },
};

/** The CSS value behind a color; a hex value passes through. */
export function colorValue(color: ResultColor | null): string {
  if (color === null) return NAMED.accent.value;
  return isResultColorName(color) ? NAMED[color].value : color;
}

/** Ink that reads on the chosen color when the option is pressed. */
export function selectedInk(color: ResultColor | null): string {
  if (color === null) return NAMED.accent.ink;
  if (isResultColorName(color)) return NAMED[color].ink;
  const value = color.slice(1);
  const full = value.length === 3 ? value.replace(/(.)/g, "$1$1") : value;
  const channels = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  return luminance > 0.42 ? "var(--rotli-cocoa)" : "var(--rotli-linen)";
}

/** Black on a dark theme and white on a light one need an edge of their own. */
export function colorEdge(color: ResultColor | null): string {
  return color === "white" || color === "black" ? "var(--border)" : colorValue(color);
}
