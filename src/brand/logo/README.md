# logo/ — rotli marks (pending formalization)

The logo direction is **Seth-approved** (the 2026-06-06 board) but **not yet formalized into SVG**. The
board is a raster; the brand doctrine forbids auto-tracing geometry. To formalize, get the marks as clean
outlined SVG from Seth's design source (Figma/AI export of the wordmark + `r` mark), or rebuild the `r`
glyph as exact path geometry, then render → judge → present → freeze.

## The marks

- **Primary wordmark:** `rotli`, lowercase, warm rounded sans, **Cocoa `#3A3028`**. The leading **`r` has a
  curled/looped tail** — the signature glyph. Even weight, rounded terminals, comfortable spacing.
- **Secondary `r` mark:** the curled-tail `r` alone, for compact use. Must stand alone.

## Deliverables (the kit must ship all)

```
logo/
  wordmark.svg                  full-color (cocoa on transparent)
  wordmark.mono.svg             single-color black
  wordmark.mono-white.svg       single-color white (knockout/reversed)
  r-mark.svg                    full-color r mark
  r-mark.mono.svg               single-color black
  r-mark.mono-white.svg         single-color white
  lockup-horizontal.svg         r mark + wordmark
  lockup-horizontal.reversed.svg
  lockup-stacked.svg            r mark above wordmark
  tray-template.svg             monochrome macOS menu-bar template mark (the r), pixel-snapped
```

(Tiles + favicon + app-icon + social avatar live under `tiles/` once the marks exist.)

## Rules

1. **Outline the wordmark to paths** — font-independent, portable; the lockup never depends on a webfont.
2. **Preserve the `r` curl exactly** — it is the one distinctive move; everything else stays calm.
3. **Survival floor:** the `r` mark must read at **16px mono** (favicon) and as a **knockout**. If the curl
   muddies, simplify the tail until it holds. The eye + Seth decide — no metric.
4. **Two masters minimum:** mono (for reversal) + brand-color. Cocoa on Linen for light; Linen/Peach on
   Cocoa for dark.
5. Render with `../../engine/TOOLS/svgshot.mjs` (look at `mark@16.png` + `mark@inverse.png` first), present
   to Seth, record the call in `../../engine/RUNS/rotli/<date>/DECISION.md`, then freeze.

> Retired: the old copper `#B87A4E` / Cabin / quokka-face tray icon. Do not reuse.
