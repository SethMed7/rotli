# rotli — icon re-cut to module truth — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (LIVE SVGs: 26px / 16px floor / mono-collapse / cocoa)
**Input:** the locked module set (Notes · Chat · Voice · Memory · Inbox · Board) + supports.

## The set (11)

| Icon | Glyph | Accent |
|---|---|---|
| Notes | document, three lines | clay first line (kept from approved draft) |
| Chat | round bubble | clay center line (family echo of Notes) |
| Voice | mic capsule | clay dot in the capsule |
| Memory | two-lobe brain | clay center seam ("the spark of recall") |
| Inbox | tray | clay unread dot |
| Board | four tiles | one clay-filled tile (kept from approved Sheets aesthetic) |
| Capture | rounded card | clay plus (replaces Quick Notes — bubble collided with Chat) |
| Tags | **tilted tag, rounded** (Seth's pick — v1 tag shape and the hash both rejected) | clay dot |
| Search | magnifier | none (kept) |
| Sync | two arrows | clay + olive (kept — the one two-hue exception, it IS the semantic) |
| Settings | three sliders | one clay knob (gear died at 16px; sliders also say "rebindable") |

**Retired:** Calendar ("not a calendar"), Sheets (Board absorbed), Transcript (Voice owns it),
Quick Notes (→ Capture), Reminder (revisit at Inbox phase), Action Items (checkboxes live in the editor).

Family rules held: 24-grid · 1.8 stroke · outline · currentColor · ≤1 clay accent (Sync excepted) ·
mono-collapse safe (accents force to ink for tray/template contexts) · 16px floor verified at 3× by
agent LOOK (`_look/`).

## On approval

1. Write `kits/rotli/icons/rotli-icons.sprite.svg` v2 (+ 11 source SVGs) — replaces draft v1.
2. Update `icons/README.md` contract + the company book icons chapter.
3. → **KIT FREEZE** (`kit.json`) — the last gate before the Stage-2 build.

## Tags replacement (Seth, same day — two passes)

Pass 1: v1 tag shape rejected → hash offered. Pass 2: Seth picked the **tilted rounded tag with the
clay dot** (the diamond-tag alternate's style); hash retired. Final Tags = Lucide-style rotated tag,
1.8 stroke, clay dot at the eyelet.

## Dark-ground color fixes (Seth, same day — "it is just colors")

- **Settings rebuilt structurally:** segmented slider lines with open knob circles (no fill masking) —
  renders crisply on any ground. The fill-hack version looked bad on cocoa.
- **Olive lift on dark:** `#8D9A76` clears AA for text on cocoa but reads muddy at 1.8px strokes →
  dark-ground icons use lifted olive **`#A9B78F`**. **At freeze:** add `--rotli-olive-bright` (or a
  dark-context `--success-icon`) to `tokens/colors.css` so this is a token, not a special case.
  Clay needs no lift (verified).

## Verdict

**APPROVED — Seth, 2026-06-11 ("perfect, let's move forward and freeze").**
Formalized into the kit: `icons/rotli-icons.sprite.svg` v2 + `icons/src/` (11 files) +
`icons/README.md` rewritten + `--rotli-olive-bright` token added to `tokens/colors.css`.
→ **KIT FROZEN 1.0.0** (`kits/rotli/kit.json`). Stage 2 open.
