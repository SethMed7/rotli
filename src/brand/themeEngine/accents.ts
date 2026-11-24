// The Primary-color choice under a custom theme. The static presets in
// themes.css were tuned for the built-in pages and fail on many custom ones,
// so each preset, and the Custom hue, is re-derived on the custom page and
// gated like the theme itself.

import { fromLch } from "./color";
import { type ModeSeeds, type TokenSet, appliedTokens, deriveMode } from "./derive";
import { audit } from "./gate";
import {
  ACCENT_PRESETS,
  ACCENT_PRESET_NAMES,
  type AccentPresetName,
  CUSTOM_HUE_ACCENT,
  type ContrastLevel,
  type Mode,
} from "./policy";

export type AccentVariant = AccentPresetName | "custom";
export const ACCENT_VARIANTS: readonly AccentVariant[] = [...ACCENT_PRESET_NAMES, "custom"];

/** The roles the static presets in themes.css set. Every variant carries
 * them, so a variant rule outranks a static preset by specificity alone. */
export const ACCENT_ROLES = ["--accent", "--accent-text", "--on-accent"] as const;

/** The tokens one Primary-color choice paints on this page: the whole set
 * re-derived with that accent and gated, keeping what changed plus the accent
 * roles. A choice that would not pass keeps the theme's own accent roles. */
export function accentVariant(
  mode: Mode,
  seeds: ModeSeeds,
  base: TokenSet,
  level: ContrastLevel,
  accent: string,
): TokenSet {
  const page = base["--ground"] ?? seeds.page;
  const derived = deriveMode(mode, { ...seeds, page, accent }, level);
  const passes = audit(derived.tokens, mode, level).every((row) => row.pass);
  const source = passes ? appliedTokens(derived.tokens) : base;
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        (ACCENT_ROLES as readonly string[]).includes(name) || (passes && base[name] !== value),
    ),
  );
}

/** The Custom hue's seed accent for a mode. */
export const customHueAccent = (mode: Mode, hue: number): string =>
  fromLch({ ...CUSTOM_HUE_ACCENT[mode], h: Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 210 });

/** Every Primary-color choice for one mode. */
export function accentVariants(
  mode: Mode,
  seeds: ModeSeeds,
  base: TokenSet,
  level: ContrastLevel,
  hue: number,
): Record<AccentVariant, TokenSet> {
  const out = {} as Record<AccentVariant, TokenSet>;
  for (const name of ACCENT_PRESET_NAMES)
    out[name] = accentVariant(mode, seeds, base, level, ACCENT_PRESETS[name][mode]);
  out.custom = accentVariant(mode, seeds, base, level, customHueAccent(mode, hue));
  return out;
}
