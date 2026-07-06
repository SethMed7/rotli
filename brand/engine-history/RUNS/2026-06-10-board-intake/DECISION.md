# rotli board intake — formalize run (2026-06-10)

**Source:** Seth supplied a regenerated brand board (`source/board.png`, 1122×1402, locked per
RULES/07 LAW 1; also mirrored to `BRANDS/rotli/_reference/brand-board.png`, which was empty until now).
Same system as the 2026-06-06 board: identical five-color palette, Satoshi/General Sans typography,
the 10-icon set, light/dark UI. The deltas this run formalizes are the **marks**.

## What was done (RULES/07: crop → trace → compare)

1. **Crops:** `source/wordmark-ink.png` (394×143 ink-tight) + `source/r-mark-tight.png` (95×131).
   ⚠️ The board's r-mark panel is only 131px tall — below the 600px tracing floor. Upscaled 6×
   (Lanczos + level) to a clean solid mask before tracing. If Seth can export a larger board,
   re-trace from that; flagged at the gate.
2. **r mark — TRACED, not parametric** (supersedes the 06-08 parametric draft v6, which ghosted
   against this board: ear too thin, head placement off). `r-mark.traced.svg` via `vectorize.mjs`
   (potrace, ~11 path commands). Compare strip `_look/r-mark-traced@compare.png`: blend is clean —
   ear notch, head, stem, tail all track the source.
3. **Wordmark — type + graft** (`build_wordmark_graft.mjs`): `otli` outlined in **Baloo 2 true-600
   static** (`BRANDS/rotli/font/Baloo2-600.ttf`), tracking −0.01; the traced quokka-r grafted as the
   leading glyph, ratio-locked to the board (r ink 96×131 board-px vs o-height 101; tail ON the
   baseline, not below; r→o gap 24 board-px).
4. **Fidelity verdict (compare `_look/wordmark-FINAL@compare.png`):** total ink width matches the
   board within 1 board-px. Residual ghosting is per-letterform variance in the AI-rendered board
   (its `t` is 73 board-px wide vs Baloo's 57, the `o` slightly rounder) — type is type (04 §4.0);
   we do not distort real glyphs to chase an AI raster. Tested: 400-vs-600 weight, tracking
   −0.01…−0.04, numerically solved per-letter positions — −0.01 @ true-600 is the best global fit.

## ENGINE BUG FOUND + FIXED — opentype.js `variation.set()` is a NO-OP

Outlines are identical at wght 400/600/800 on Baloo2-Variable: **every prior "Baloo 2 @600" output
(incl. the gate-1 base and the seeded kit logos) was actually the 400 default master.** Fix: true
statics instanced via `fonttools varLib.instancer` → `BRANDS/rotli/font/Baloo2-600.ttf` (+700).
`TOOLS/wordmark.mjs --weight` now hard-fails on a variable font with instancing instructions.
(Local venv used for fonttools lives at `.venv-fonts/` in this run folder, gitignored-by-pattern? — it is
disposable; delete freely.)

## Standard ladder

- r mark `_look/mark@16.png` — reads as the quokka-r at favicon floor. ✓
- r mark `_look/mark@inverse.png` — knockout holds. ✓
- wordmark `_look-wordmark/mark@32.png` — "rotli" reads. ✓

## Gate round 1 (2026-06-11) — REJECTED: crooked edges

Seth zoomed the live SVG and called out lumpy curves + a kinked tail-stem junction — raw-trace
artifacts of the 131px source. **Fix (`build_retrace.mjs`):** curvature-limited smoothing
(1200% upscale → blur 0x10 → 50% re-threshold ×2 — keeps the edge midline, kills the wobble) +
potrace `alphaMax 1.3 / optTolerance 0.6` → 8-command path, junctions verified clean at 2000px zoom
(`_look/zoom-tail.png`, `_look/zoom-ear.png`); board fidelity re-confirmed
(`_look/r-mark-smooth@compare.png`, `_look/wordmark-SMOOTH@compare.png`).
**Curated:** `vectorize.mjs` now exposes `--smooth/--alphamax/--opttol`; RULES/07 LAW 2 documents the
low-res recipe + the ≥2000px junction inspection. Also this round: gates are **live-SVG `gate.html`**,
never PNG (rule in `brand/CLAUDE.md` + 07 LAW 3).

## Gate round 2 (2026-06-11) — REJECTED: flat bottom terminal

"The bottom has a flat part that should flow better — everything should flow." The stem's bottom was
the trace's flat chord (3 segs at max-y, x≈376–537). **Fix (`build_flow_bottom.mjs`):** path surgery,
not a re-trace — replaced the flat run with ONE cubic, G1 tangent-matched to both neighbors, apex ~8
units below the old flat (round terminal w/ slight baseline overshoot). Verified: 2000px zoom
(`_look/zoom-bottom-flow.png`) + board compare (`_look/r-mark-flow@compare.png`) — the extra bottom
fullness vs the board IS the judged refinement. Wordmark regenerated with the flowed r.
**Design note for the kit:** the r's silhouette is now 100% curve — no straight segment anywhere.

## Board sign-off (Seth, 2026-06-11): ✅ APPROVED — full Stage-1 board (marks, tiles, fonts, icons v1)
Freeze deliberately DEFERRED: Seth wants the brand-world asset step first (camino Stage-1.5 pattern,
but illustrated — quokka characters, environments, details; not photoreal). Imagery lands in the kit,
THEN kit.json. Next run: `RUNS/rotli/2026-06-11-imagery/`.

## GATE (Seth) — round 3: ✅ APPROVED (2026-06-11)

"I approve the mark gate." Wordmark (Baloo 2 true-600 + traced quokka-r graft, tracking −0.01) and
r-mark (smooth trace + flowed bottom) are the rotli marks. Formalized into `kits/rotli/logo/`;
Stage 1 build-out (board rebuild, fonts/LICENSES, tiles, icons review) proceeds toward the
`kit.json` freeze call.

Presented: **`gate.html`** — live SVGs on light/dark grounds, small sizes, CSS 50% blends over the
board crops. (PNG strips in `_look/` are the agent's LOOK only — Seth gates on SVG, never PNG;
rule curated into `brand/CLAUDE.md` + `RULES/07` this run.)
On approval: copy `wordmark.svg/.mono/.mono-white` + `r-mark.svg/.mono/.mono-white` into
`kits/rotli/logo/`, rebuild `board.html` from kit SVGs, then proceed to fonts/tiles/LICENSES and the
`kit.json` freeze call. **Do not advance without the verdict.**
