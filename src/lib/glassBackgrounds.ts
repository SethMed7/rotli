// Bundled liquid-glass wallpapers — generated in the rotli palette + Seth's
// dusk blue (2026-06-12, gpt-image-2 via /imagegen). The "field" background is
// pure CSS (the tint-blob field in themes.css); "custom" is a user upload.

import type { GlassBackground } from "../state/ui";
import blush from "../assets/glass/blush.jpg";
import cocoa from "../assets/glass/cocoa.jpg";
import dusk from "../assets/glass/dusk.jpg";
import linen from "../assets/glass/linen.jpg";

/** Keyed by the GlassBackground union (minus the non-image members), so a new
 * background added without an asset fails to COMPILE instead of silently
 * falling back to the field. */
export const GLASS_BG_SRC = {
  dusk,
  blush,
  linen,
  cocoa,
} satisfies Record<Exclude<GlassBackground, "field" | "custom">, string>;
