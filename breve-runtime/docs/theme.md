# Breve PDF themes

Rotli owns Breve's PDF appearance. Since 2026-09-02 the default is **Match
Rotli**: the main window resolves its live semantic tokens into
`pdfTheme.resolved` in `<vault>/.rotli/routines/config.json` on every
appearance change (`breve_write_pdf_palette`, a slice write that never touches
routines, delivery, or the preset choice), and `scripts/pdf-theme.ts` renders
with that palette. The four named palettes below and a custom six-colour
palette remain explicit choices in **Breve → Settings → PDF appearance**.
Theme changes affect newly rendered scheduled and on-demand PDFs; existing
files keep the colours they were rendered with.

Every runtime entry point reads the same config (`config-path.ts`
`CONFIG_PATH`: `ROTLI_BREVE_CONFIG`, else the vault's `routines/config.json`
beside the managed home), so an interactive `/breve` render, `email-topic.ts`,
and the chat's PDF artifact all use the chosen palette, not a default.

The renderer is the single source of presentation truth. Brief-writing agents
write Markdown only and never hard-code a palette into an output. The chat's
"create a PDF" artifact (`scripts/render-document.ts`) shares the palette and
the print rules with the brief renderer; only the masthead differs.

## Token roles

| PDF role | App token (Match Rotli) | Use |
|----------|-------------------------|-----|
| `--bg` | `--ground` | page background (full-bleed — no white margins ever) |
| `--surface` | `--surface` | cards, panels, lede box, code |
| `--ink` | `--text` | primary text |
| `--muted` | `--text-muted` | secondary text, metadata, captions |
| `--accent` | `--accent-text` | kickers, links, numbers, highlights (the AA text role, not the fill) |
| `--rule` | `--border` | hairlines, borders |

A palette is only written when all six roles resolve to `#rrggbb`; a custom
accent hue (`oklch(...)`) is normalized through a canvas round-trip first. Until
the app has synced once, the renderer stands in with Warm Light, Rotli's own
default appearance.

## Named presets

- **Charcoal:** the original Breve palette — `#161616` page, `#1f1e1c` panels,
  warm off-white ink, amber accent.
- **Warm Light:** Rotli linen page, white panels, cocoa text, clay links.
- **Warm Dark:** Rotli cocoa surfaces with linen text and clay links.
- **Paper:** neutral white page, near-black text, restrained clay links.
- **Custom:** page, panel, text, secondary text, accent, and rule colours
  chosen in Rotli. Rotli prevents saving combinations that fail readable
  contrast (4.5:1 text, 3:1 accent).

The preset tables in `src/brand/brevePdfThemes.ts` and `scripts/pdf-theme.ts`
are asserted equal by `tests/test-pdf-theme.ts`.

**Logo / mark:** the **B̆ monogram** — a bold navy `B` with the amber breve ˘
above it (from *caffè breve* + the typographic breve diacritic). Coffee
identity, one minimal mark (`media/icon.svg` + `icon.png`).

Type: **Georgia serif** for reading body in briefs; **system sans, uppercase,
letter-spaced (0.2em+)** for labels/kickers/section headers. Print uses
`print-color-adjust: exact` and the renderer's controlled page margins so every
palette survives PDF output accurately.

**Type scale (phone-first, set 2026-06-10):** body/items **12.5pt**, lede
**14pt**, section headers **10.5pt** spaced caps, metadata/labels **9pt**,
inline code **11pt**. **Single column everywhere** — no multi-column layouts
(zig-zag reading when zoomed on a phone). Briefs are read primarily on your
phone; bias every layout decision toward that.
