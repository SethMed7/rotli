# rotli brand layer

The product identity is the canonical line-drawn quokka in
`src/assets/characters/_logo.svg`. The retired curled-`r` mark and its generated
wordmark/tile family are intentionally absent from this live kit.

## Current assets

- `tokens/` — light/dark color roles and typography.
- `icons/` — Rotli's interface glyph system.
- `providers/` — provider-owned model marks with their own provenance.
- `../assets/characters/` — the canonical quokka drawings. `_logo.svg` is the
  compact line mark. `masks/` lets the original full-body geometry accept the
  complete user-selected palette. `concepts/layers/` holds approved thoughtful,
  walking, listening, attention, and accessory artwork split into body, ink,
  preserved expression detail, and strictly colorable accessory masks. Accessory
  fills are inset under their selected black-or-white ink so original raster
  color cannot fringe the character.

The companion may use Line, Cocoa, Fern, Ocean, Iris, Berry, Amber, or a custom
hue for its body, plus black or white ink. Glasses, a bucket hat, and goggles
are optional and carry their own custom hue. The product companion may
be disabled entirely outside onboarding. None of these choices may alter the
compact product mark, provider identities, tray icon, or app icon.

## Product boundary

Components consume semantic roles composed in `src/styles/base.css` and
`src/styles/themes.css`; they do not reach into fixed palette values. Product
material remains flat: no glows, shadows, backdrop blur, or decorative filters.

Historical brand explorations remain under `brand/engine-history/` for
provenance. They are not current assets and must never be imported by product,
site, native-shell, or experiment code.
