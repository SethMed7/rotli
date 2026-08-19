# rotli — UI/UX mockups · notes module · round 3 — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (live render, kit tokens only)
**Input:** the maintainer's round-2 feedback + two web-research passes (competitor love/hate: Apple Notes, GoodNotes,
Evernote, Bear, Craft, Obsidian, Notion, UpNote, iA Writer/Ulysses/Typora · premium standards: Linear,
Raycast, Things, Arc, Superhuman, Material 3, Radix/Geist). Research briefs: session tasks
`a799b3e49391cc869` (competitors) + `a2d88b131919531c0` (standards).

## Research → design decisions

| Evidence | Decision |
|---|---|
| Bear's ^1/^2/^3 pane collapse is the most-loved "clean view" in the category | Every rail collapses: ⌘0 folders, ⌥⌘L list, both off = just the note; warm-edge hover-reveal (Arc), state remembered per window |
| Apple Notes' Aa popover = canonical hidden-formatting anti-pattern ("two passes for bold+italic") | Inline marks live in a selection bubble (appears on selection only, above it, never covering it); Aa holds ONLY typography |
| Markdown has no underline; Bear invented marks, Obsidian uses HTML, iA refuses | Underline = `<u>…</u>` (portable/Obsidian-compatible), highlight = `==…==` always Peach; bold/italic/strike native syntax |
| iA: "appearance lives in a styling layer the document never stores" + Craft's loved per-doc styling | Aa = paragraph style · text size stepper · measure (Narrow/Comfort/Wide); saved per-note in `.rotli/`, never written to the `.md` |
| iA/Ulysses/UpNote focus modes; ~65ch enforced measure; typewriter scroll | Focus mode ⌥⌘F: chrome leaves, locked ~65ch centered column, typewriter scroll, paragraph dimming, ghosted traffic lights, Esc restores |
| Raycast/Linear/cmdk: top-third anchor (never vertical center), ~640px, recents on empty, inline shortcut education, blur-the-surface/dim-the-backdrop | ⌘K v2: horizontally centered, 96px top anchor, 640px; backdrop dim rgba(58,48,40,.38) + 7px blur; Recent + Suggested on empty; kbd hints right-edge; footer grammar row |
| Material state layers, Radix radius tokens, one focus ring (2px/2px offset), ≤200ms motion | The shape & state grammar (frame G): radii 4/8/10/12/14/999; hover = 7% ink (8% paper in dark); selected = tint/surface-merge; focus-visible = 2px clay ring; exit faster than enter |
| GoodNotes' Catalyst Mac port hatred; Notion lag | Reaffirms: native feel + instant everything are non-negotiable |

## Frames

A — **Module chassis**: Inbox fully mocked in the identical shell (accounts rail with kit chip dots, thread
list, thread view, linked-note slot) + Wiki/Voice/Board minis. Grammar: identity · optional rails · content;
threads/chats/answers are tab types in the same pane system.
B — **Collapse states**: full → ⌘0 → ⌘0+⌥⌘L (just the note), warm-edge reveal sliver shown.
C — **Formatting**: selection bubble (B I U S highlight code link, cocoa surface, radius 10) + Aa panel
(Body/Heading/Mono · size stepper · measure) with the storage note.
D — **Light ↔ dark side-by-side**, live-cloned from one markup (cannot drift).
E — **Focus mode**.
F — **⌘K v2** (centered, dim+blur over the real window).
G — **Shape & state grammar board** — the law all mocks in this gate already obey, including the new
`--hov`/`--act` tokens.

## Round-3 calls for the maintainer

1. Does Inbox-in-the-chassis settle the "built for modules" doubt? If not, what still feels off?
2. Collapse grammar (⌘0 / ⌥⌘L / warm edge / remembered) — approve?
3. Formatting split (bubble = marks in markdown; Aa = styling layer) + `<u>` for underline — approve?
4. Focus mode paragraph dimming: default ON or OFF?
5. ⌘K backdrop: dim+blur as mocked, or dim-only?
6. Grammar board → fold into DESIGN.md as component law on approval.

## Verdict (the maintainer, 2026-06-11)

- ✅ **Focus mode — approved** ("I love the focus mode").
- ✅ **⌘K v2 — approved** ("and the updated search").
- 🔁 **Editor footer** — replace with a floating bottom status pill: where saved · character count · last updated → r4.
- 🔁 **Rail collapsing** — needs visible toggle buttons, not hotkeys-only → r4.
- 🐛 **Light mode invisible** — the maintainer's system dark + the kit's `prefers-color-scheme` rule flipped the whole gate dark, including the "Light" demo. Fixed: all gates pin `data-theme="light"`; dark is explicit-only (`.rotli-dark`).
- ❓ **Inbox** — "how are we talking to people, where are conversations saved, v1 is local only?" → answered in r4 frame C (email client over your own accounts; provider is the source of truth; local SQLite cache; no rotli server; v1 = Notes only, Inbox = Phase 5).
- 📌 Reaffirmed: **v1 editor is markdown-style**; doc-style is a later view mode.

Continued in `../2026-06-11-ui-notes-mockups-r4/`.
