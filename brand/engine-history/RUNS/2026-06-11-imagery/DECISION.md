# rotli — Stage 1.5 · 2026-06-11 · brand-world assets (illustrated)

**Scope (Seth's direction):** before any app code, generate the assets that take the brand to life —
NOT photoreal (camino's register); illustrated world-building: **quokka characters, environments,
details**. Freeze (`kit.json`) deliberately deferred until these land in the kit.

## A · Imagery (GENERATED — /imagegen · Antigravity engine · Nano Banana Pro, Google AI Pro sub, 8 generations)

Sequential `agy` runs (`gen_all.sh`; concurrent agy sessions hang — skill rule held). Shared spine:
warm flat-shaded storybook illustration, bouba shapes, matte grain, locked palette hexes inline.
See `manifest.md` for full prompts.

- `quokka-master.png` 1024² — THE character: round, calm, cocoa fur/peach belly/clay cheeks, on linen
- `quokka-poses.png` 1024² — same character ×4: writing · listening · holding tag · asleep
- `island-wide.png` 1024² — linen dunes, olive shrubs, distant lit hut, vast peach sky (hero)
- `lamp-nook.png` 1536×1024 — desk at night, one lamp pool on paper (dark-mode hero)
- `island-path.png` 1024² — dusk path to a cozy distant glow (journey/onboarding)
- `paper-linen.png` 1536×1024 — near-flat linen ground
- `cocoa-night.png` 1024² — near-flat dark warm ground
- `botanical-spots.png` — cut-out spot elements (sprigs, pebble, flower, shell)

## B · Code assets (CONSTRUCTED)

- `pattern/curl-flourish.svg` — the r-tail curl as a sparing monoline motif (dividers/bullets)
- `pattern/dot-grid.svg` — soft offset paper-dot tile
- `css/textures.css` — grain overlay (feTurbulence data-URI), linen/dark/peach fields, dot mask field,
  WCAG scrims, soft warm shadow
- `css/motion.css` — ONE idea: the visitor. `.ro-visit` (crossfade + 1px lift, 360ms), `.ro-settle`
  scroll reveals, opacity-only wordmark stagger (camino SVG-transform lesson applied), quiet hover,
  reduced-motion with `!important`

## Cohesion gate — `cohesion.html` (build: `build_cohesion.mjs`, kit SVGs INLINED — file:// fetch lesson)

Six sections: light hero (island-wide) · character (quokka) · dark hero (lamp-nook) · journey
(island-path + cards) · **code-only** (fields+grain+dots+curl+live marks, no imagery) · details
(spots + grounds) · dark footer. Live kit wordmark/r-mark + real kit fonts throughout.

## My LOOK — flags for the gate

1. **Expression drift:** quokka-master has sleepy closed eyes; the poses sheet has open eyes. Pick
   the canonical face (master's closed-eye calm is more "quiet") — can regenerate either to match.
2. **Aspects:** most outputs came back 1024² despite wide prompts (engine behavior). Compositions
   hold; heroes work with CSS cover-crops. Regenerate true-wide on request.
3. **paper-linen** vignette is warmer/stronger than "below conscious perception" — usable as a hero
   paper field; the code-only `.ro-linen-field` covers the subtle case.
4. **island-path** sky runs duskier (brown-peach) than the palette's peach — sells the journey;
   slightly off-board. Keep/kill is Seth's call.

## GATE (Seth, 2026-06-11) — SOFT-APPROVED: "overall this is good — we can play around more"

Direction confirmed; per-asset refinement deliberately left open. Next: **discovery mode** (see
`apps/rotli/docs/DISCOVERY.md`) — understand the product deeply, then enhance the world from there
(canonical quokka face, asset aspect fixes, palette drift, in-product asset mapping). Nothing approved
here gets broken; refinements layer on through their own gates. `kit.json` freeze remains deferred
until Seth calls the world right.

## Original gate ask (for the record)

Open `cohesion.html` — judge: does it all read as ONE brand? Per-asset keep/kill; character face
canon; pattern opacity; motion speed. On approval → kit gets `imagery/` + `pattern/` + `css/`,
board.html gains a world section, **then `kit.json` freeze**, then Stage 2.
