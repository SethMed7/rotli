# Breve PDF themes

Rotli owns Breve's PDF appearance. The default remains the original Charcoal
palette below, while `settings.json` can select Warm Light, Warm Dark, Paper, or
a custom six-color palette from **Breve → Configure → PDF appearance**. Theme
changes affect newly rendered scheduled and on-demand PDFs; existing files keep
the colors they were rendered with.

The renderer is the single source of presentation truth. Brief-writing agents
write Markdown only and never hard-code a palette into an output.

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#161616` | page / app background (full-bleed — no white margins ever) |
| `--card` / `--tint` | `#1f1e1c` | cards, panels, lede box |
| `--ink` | `#e9e7e2` | primary text (warm off-white) |
| `--ink-soft` | `#a8a49c` | secondary text |
| `--ink-faint` | `#6f6b63` | metadata, captions |
| `--accent` | `#d9a868` | amber — kickers, links, numbers, highlights |
| `--accent-deep` | `#c8965a` | link hover / deep accent |
| `--alert` | `#e08585` on `#241314`, border `#4e2323` | action items, warnings |
| `--rule` | `#2e2c29` | hairlines, borders |
| Cream | `#f2efe9` | primary buttons (dark text on cream), masthead highlights |
| `--blue` (navy) | `#1f2d4d` | secondary structural accent + the logo mark (deep ink navy); fills, the brand mark |
| `--blue-soft` | `#3a5f8f` | lighter navy for accents/links that need contrast on the dark `--bg` |

**Logo / mark:** the **B̆ monogram** — a bold navy `B` with the amber breve ˘ above it (from *caffè breve* + the typographic breve diacritic). Coffee identity, one minimal mark (`media/icon.svg` + `icon.png`). Amber stays the talking accent (links, kickers, heads); navy is structure + the mark.

Type: **Georgia serif** for reading body; **system sans, uppercase, letter-spaced (0.2em+)** for labels/kickers/section headers. Print uses `print-color-adjust: exact` and the renderer's controlled page margins so every palette survives PDF output accurately.

## Presets

- **Charcoal:** the established Breve palette documented above.
- **Warm Light:** Rotli linen page, white panels, cocoa text, clay links.
- **Warm Dark:** Rotli cocoa surfaces with linen text and clay links.
- **Paper:** neutral white page, near-black text, restrained clay links.
- **Custom:** page, panel, text, secondary text, accent, and rule colors chosen
  in Rotli. Rotli prevents saving combinations that fail readable contrast.

**Type scale (phone-first, set 2026-06-10):** body/items **12.5pt**, lede **14pt**, section headers **10.5pt** spaced caps, metadata/labels **9pt**, inline code **11pt**. **Single column everywhere** — no multi-column layouts (zig-zag reading when zoomed on a phone). Briefs are read primarily on your phone; bias every layout decision toward that.
