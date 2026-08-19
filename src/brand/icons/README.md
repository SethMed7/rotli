# rotli icons — v2 (FROZEN 2026-06-11)

**Run:** `engine/RUNS/rotli/2026-06-11-icons-recut` (gate APPROVED by the maintainer — Tags revised twice to the
tilted rounded tag; Settings rebuilt segmented; dark olive lifted). Replaces the v1 draft contract
(10 board-era icons — Calendar/Sheets/Transcript etc. retired; reasons in the run's DECISION.md).

## The set — 11 symbols, re-cut to module truth

| id               | Name                | Accent                                                             |
| ---------------- | ------------------- | ------------------------------------------------------------------ |
| `rotli-notes`    | Notes (module)      | clay first line                                                    |
| `rotli-chat`     | Chat (module)       | clay center line                                                   |
| `rotli-voice`    | Voice (module)      | clay dot in the capsule                                            |
| `rotli-memory`   | the Memory (module) | clay center seam                                                   |
| `rotli-inbox`    | Inbox (module)      | clay unread dot                                                    |
| `rotli-board`    | Board (module)      | one clay-filled tile                                               |
| `rotli-capture`  | Quick capture       | clay plus                                                          |
| `rotli-tags`     | Tags                | clay dot at the eyelet                                             |
| `rotli-search`   | Search              | —                                                                  |
| `rotli-sync`     | Sync                | clay + olive pair (the one two-hue exception — it IS the semantic) |
| `rotli-settings` | Settings            | one clay knob                                                      |

## Family law

24-grid · 1.8 stroke · round caps/joins · outline · `currentColor` · ≤1 clay accent per icon
(sync excepted) · every icon labeled in UI, visible or hover (the quokka rule — no learning the
island's secret symbols).

## Context rules

- **Dark grounds:** lift olive to `var(--rotli-olive-bright)` (#A9B78F): in CSS,
  `[stroke="#8D9A76"]{stroke:var(--rotli-olive-bright)}` (+ same for `fill`). Clay needs no lift.
- **Mono / template / tray:** force accents to ink — `[stroke="#C97E62"],[stroke="#8D9A76"]{stroke:currentColor}`
  (+ same for `fill`). Verified as the knockout test at the gate.
- **Survival floor:** verified at 16px (gate `_look/`). Don't use below 14px.

## Files

- `rotli-icons.sprite.svg` — `<symbol>` sprite; inline it (or `<use href="#rotli-…">` same-document).
- `src/rotli-*.svg` — 11 standalone sources (same geometry).
