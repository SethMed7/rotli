# rotli kit — font & asset licenses

All faces are self-hostable. **No rented/metered fonts** (per the brand doctrine — Avenir-class faces banned).

## Satoshi — display / headings
- **License:** Fontshare (Indian Type Foundry) Free Font License — free for personal & commercial use, web-embeddable. NOT OFL; a deliberate, Seth-approved deviation from the studio's standard Fontsource catalog.
- **Source:** `fontshare.com`.
- **Files:** `fonts/Satoshi-Regular.woff2` (400), `Satoshi-Medium.woff2` (500), `Satoshi-Bold.woff2` (700).

## General Sans — UI / body
- **License:** Fontshare (Indian Type Foundry) Free Font License — same terms as Satoshi.
- **Source:** `fontshare.com` (`api.fontshare.com/v2/fonts/download/general-sans`, 2026-06-11).
- **Files:** `fonts/GeneralSans-Regular.woff2` (400), `GeneralSans-Medium.woff2` (500), `GeneralSans-Semibold.woff2` (600).

## Baloo 2 — wordmark source only
- **License:** SIL Open Font License 1.1 (OFL).
- **Source:** Google Fonts → `ofl/baloo2`; `fonts/Baloo2-600.ttf` is a true static wght=600 instance cut with `fonttools varLib.instancer` from `engine/BRANDS/rotli/font/Baloo2-Variable.ttf` (opentype.js cannot outline variable axes — see RUNS/rotli/2026-06-10-board-intake).
- The wordmark ships as **outlined SVG paths** (`logo/wordmark.svg`) — production never loads Baloo 2; the file is kept for provenance/regeneration.

## Marks & icons
- The **quokka-r** (`logo/r-mark.svg`) is a smooth trace of Seth's approved 2026-06-10 brand board (gate round 3 approved 2026-06-11), with a judged flowing-bottom refinement; the wordmark is outlined Baloo 2 @600 with the traced r grafted as the leading glyph. Both are original-work transcriptions for rotli, built in `engine/RUNS/rotli/2026-06-10-board-intake/`.
- The 10-icon sprite (`icons/rotli-icons.sprite.svg`) is constructed original work on the 24-grid.
