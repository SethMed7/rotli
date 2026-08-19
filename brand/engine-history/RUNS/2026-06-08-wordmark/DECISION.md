# rotli wordmark — formalize run (2026-06-08)

## Root cause (why v1 was broken)
rotli's first `logo/wordmark.svg` was hand-authored as **six stroked `<path>`s faking the letters**
(uniform monoline, hookless `r`) — it bypassed the engine's font-outlining pipeline entirely and
read nothing like the board. Fleet Aware + Camino were correct (real outlined glyphs). This violated
RULE 3.1 ("wordmark MUST be set in the brand's display font").

## Fix (method)
- New first-class tool `TOOLS/wordmark.mjs` (name + display font → outlined wordmark.svg/.mono/.mono-white
  via opentype.js, `--weight` for variable faces). Shared glyph-outliner extracted to `lib/type.mjs`;
  `lockup.mjs` refactored onto it. Rule hardened in `RULES/04-formalize-svg.md` §4.0; documented in
  `TOOLS/README.md` §2b. Hand-drawing letterforms now explicitly banned.

## Base face — the maintainer-approved (gate 1)
**Baloo 2 @600**, Cocoa `#3A3028`, tracking -0.01. Decisive match to the board's rounded `otli`.
Font vendored to `BRANDS/rotli/font/Baloo2-Variable.ttf`. Base regenerated into `kits/rotli/logo/`.

## Signature glyph — the quokka-`r` (gate 2 — PENDING)
The board `r` = a quokka abstracted into a letter: ear (top-left nub) · round head (top-right) ·
bulged body · curling tail. Rebuilt as clean filled geometry over 6 passes → `r-mark.draft-v6.svg`.
Close, faithful; final polish (head roundness, proportions) awaiting the maintainer's call. See
`03-WORDMARK-vs-board.png`. Not yet grafted into the frozen deliverables.
