# kits/rotli — marks APPROVED · freeze pending

Stage-1 brand kit for **rotli**, built from the Seth-approved brand board (2026-06-06, regenerated
2026-06-10). The **marks passed the human gate (round 3, 2026-06-11)** — what remains before the
`kit.json` freeze is Seth's sign-off on the full board (`board.html`), mainly the icon set.

## Confirmed (DATA + approved vectors)

- `brand.json` — single source of truth: identity, voice, palette, type, shape, icons, motion.
- `tokens/` — colors.css/json (semantic light/dark surfaces + WCAG contrast matrix) · type.css.
- `logo/` — **✅ approved**: `wordmark.svg` (outlined Baloo 2 true-600 + traced quokka-r grafted as the
  leading glyph) and `r-mark.svg` (smooth trace of the board's r, flowed bottom), each in
  cocoa / `.mono` / `.mono-white`. Built + judged in `engine/RUNS/rotli/2026-06-10-board-intake/`.
- `tiles/` — favicon · app-icon-512 · social-avatar-1024 · tile-{linen,cocoa,clay}, generated from the
  approved r (`build_tiles.mjs` in the run).
- `fonts/` — self-hosted: Satoshi + General Sans (Fontshare, variable + statics) for UI; `Baloo2-600.ttf`
  (OFL, true static instance) as wordmark source/provenance. See `LICENSES.md`.

## Pending (the freeze gate)

- **Icons** — `icons/rotli-icons.sprite.svg` is draft v1 on the 24-grid; judge on `board.html`.
- **`kit.json`** — the freeze marker. Written only on Seth's board sign-off; freeze opens Stage 2
  (`apps/rotli` vendors this kit).

## Review artifact

`board.html` — the branded guidelines doc, rebuilt 2026-06-11 **from the kit vectors** (live SVG,
self-hosted fonts, no CDN). Open it in a browser; that's where the freeze call happens.

## To change a frozen kit (once it exists)

Never edit a frozen kit in place — re-enter Stage 1, bump `kit.json`, re-pull into `apps/rotli`.

Brief: `../../engine/BRANDS/rotli/brief.md` · Board source: `../../engine/BRANDS/rotli/_reference/`.
