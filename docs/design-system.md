# rotli — Design System

Warm, quiet, instant. A menu-bar visitor, not a resident. This restates rotli's visual direction. The *feel* rules come from [philosophy.md](./philosophy.md); this doc owns the palette, type, and form.

Source of truth: the vendored brand kit at `src/brand/tokens/` (`colors.css` · `type.css`) — read-only. No raw hex in product code; drive everything from the tokens.

## The soul

Cognitive quiet · warmth as the brand · everything instant · local-first as a feeling · every control earns its place · the quokka principle (every icon labeled, every hotkey rebindable) · the four themes — Warm Light, Warm Dark, Paper, Charcoal — plus a Liquid Glass mode (tints: Dusk · Blush · Clay · Olive) layerable over any of them.

## Color

Brand palette — exactly five:

| Name | Hex | Role |
|---|---|---|
| **Cocoa** | `#3A3028` | Primary text / ink; the wordmark in light mode; dark-surface base tone |
| **Clay Blush** | `#C97E62` | The signature accent — active states, progress, key moments. A signature, not a theme. |
| **Peach Cream** | `#F2D6C2` | Warm tint — selected rows, subtle highlights, accent backgrounds |
| **Linen** | `#F8F2E9` | Lightest warm surface / light-mode ground (never pure white) |
| **Olive Moss** | `#8D9A76` | Secondary / success accent — checkmarks, sync, "all caught up" states |

Semantic surfaces (see `src/brand/tokens/colors.css` for the full set + the contrast matrix in `colors.json`):

- **Light:** ground Linen `#F8F2E9` · surface `#FFFFFF` · surface-2 `#F1E7D8` · text Cocoa `#3A3028` ·
  muted `#6E6155` · border `#E7DBC9` · accent Clay `#C97E62` · accent-text (AA) `#8F4E37` · tint Peach
  `#F2D6C2`.
- **Dark (warm, never clinical):** ground `#241D18` · surface `#2E2620` · surface-2 `#392F28` · text
  `#F1E7DA` · muted `#B7A593` · border `#3D3229` · accent Clay `#C97E62` (clears AA on the cocoa ground).
- **Two families, four themes:** the warm pair above (Warm Light · Warm Dark) keeps every value warm — if it has blue in it, it doesn't belong; the neutral pair (**Paper** · **Charcoal**) runs the same layout at near-zero saturation for a cooler, quieter ground.

Rules: no pure white in light mode (use Linen / `#FFFFFF` cards). No pure black for UI (Cocoa is the ink).
Clay is punctuation — never body text, never two clay elements competing at once. Borders translucent +
warm. For small accent *text/links* on light, use clay-deep `#8F4E37` (Clay itself is AA-large/UI only).

## Typography

- **Display / headings:** **Satoshi** (Bold). · **UI / body:** **General Sans** (Regular / Medium). ·
  **Wordmark:** **Baloo 2** (600) — the rounded, friendly face that pairs with the line-art quokka mark.
  Fallback: Inter / `-apple-system`. All faces self-hosted (see `src/brand/tokens/type.css`).
- Scale (from the board): **Heading** 32/40 Bold · **Subheading** 20/28 Medium · **Body** 14/22 Regular ·
  **UI Label** 12/16 Medium. The wordmark ships as an outlined SVG, so the mark has no runtime font dependency.
- Line height: UI ~1.4; note body ~1.6 (comfortable reading); display tight.

## Iconography

One cohesive family, outline style, consistent stroke, on a fixed grid; each icon = one idea, with a
hover label (quokka principle). Accent sparingly with Clay (and Olive for success/sync). The vendored set
lives at `src/brand/icons/`.

## Form

- **Rounded + soft.** The wordmark's rounded warmth sets the tone — pill buttons, 12px cards, gentle
  radii. Nothing sharp or clinical.
- **Shadows are warm and subtle** in light; deeper in dark. Prefer shadow over border for elevation.
- **Motion is calm + instant.** Window show/hide is a crossfade with a 1px lift, not a slide. Animate
  transform/opacity only; respect `prefers-reduced-motion`. The app visits; it doesn't sweep in.
- **8px spacing grid**; generous quiet; empty beats busy.

## Quiet AI

When AI writes into a note (chat-on-note surfaces), it obeys the same cognitive-quiet rules as everything
else: **sentence/paragraph-level reveals** (opacity only, respects `prefers-reduced-motion`) — never
character-by-character shimmer; status is one static muted line, never a spinner; **zero AI indicators in
the note list**; the freshest AI edit sits on a Peach tint that fades to ground as it settles. The note body
is the living summary the user keeps; chat transcripts are sidecar files, never part of the `.md`. And the
organizer only ever changes a note's location and metadata — never its words.
