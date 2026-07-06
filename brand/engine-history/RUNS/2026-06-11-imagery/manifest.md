# rotli imagery manifest — brand-world assets (Stage 1.5, pre-freeze)

**Register (Seth's direction, 2026-06-11):** NOT photoreal. Illustrated world-building — quokka
characters, environments, textural details — "things that can be used to take this to life."
Engine: `agy` (Nano Banana Pro) — the imagegen skill's illustration/stylized engine.

**Shared prompt spine:** warm flat-shaded storybook illustration, soft rounded shapes (bouba), matte
paper-grain feel, lamplit calm, generous quiet negative space for type, no text in image.
**Locked palette inline in every prompt:** Cocoa #3A3028 · Clay Blush #C97E62 · Peach Cream #F2D6C2 ·
Linen #F8F2E9 · Olive Moss #8D9A76 (dark ground #241D18).

## A · The character (the quokka — brand metaphor made visible)

| file | subject |
|---|---|
| quokka-master.png | THE rotli quokka: small, round, calmly smiling, cocoa fur with peach belly, sitting upright on linen ground — the canonical character, ¾ view |
| quokka-poses.png | character sheet, same quokka, 4 poses on linen: writing in a tiny notebook · listening (ear up, voice) · holding a tag/label · curled asleep (quiet) |

## B · Environments (the island designed for it)

| file | subject |
|---|---|
| island-wide.png | wide illustrated Rottnest-like island scene: gentle olive-moss vegetation, linen sand, calm peach-cream sky, cocoa accents — hero environment, horizon low, big quiet sky |
| lamp-nook.png | interior vignette: warm desk corner at night, small lamp pool of light on paper, cocoa-dark surroundings — "paper under a desk lamp" (dark-mode hero) |
| island-path.png | small winding path through soft dune grass toward a cozy distant glow — journey/onboarding scene |

## C · Details / grounds

| file | subject |
|---|---|
| paper-linen.png | near-flat warm linen paper texture, #F8F2E9, soft grain — light ground |
| cocoa-night.png | near-flat deep warm cocoa field #241D18, faint paper tooth — dark ground |
| botanical-spots.png | sparse spot illustrations on linen: olive sprigs, small leaves, a smooth pebble — cut-out detail elements |

## D · Code assets (CONSTRUCTED, not generated)

- `pattern/curl-flourish.svg` — the r's tail curl as a sparing tileable motif (from the approved mark geometry)
- `pattern/dot-grid.svg` — soft paper-dot texture tile (brand.json texture candidate)
- `css/textures.css` — grain overlay, linen/cocoa gradient fields, WCAG scrims
- `css/motion.css` — calm + instant: crossfade + 1px lift (the window "visits"), reduced-motion honored

## Gate

`cohesion.html` — sections composing imagery + patterns + textures + motion + live kit SVGs + real
fonts; one section code-only. Per-asset keep/kill by Seth. On approval → kit `imagery/` + `pattern/` +
`css/`, board.html gains a world section, THEN `kit.json` freeze.
