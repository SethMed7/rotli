# rotli — Logo & Identity Brief

*The input the Mark System consumes for `BRANDS/rotli`. Direction is **Seth-approved** via the rotli brand
board (2026-06-06) — see `_reference/NOTE.md`. Generate → Critique → Human-judge → Formalize per
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md). Prompt scaffolds:
[`../../RULES/03-prompt-recipes.md`](../../RULES/03-prompt-recipes.md).*

> **House rule.** AI generates · rules guide · the human judges · code formalizes. The judge is the
> **EYE + the premium rubric + Seth — never a metric.** Premium = **simplicity that compiles**, not
> accumulation. The **16px-mono render is the survival floor**. The logo + colors here are already
> Seth-judged (the board); what remains is to **formalize** the marks into clean SVG and draw the icon
> set, then bring them to the freeze gate.

---

## 0 · Snapshot

| Field | Value |
|---|---|
| **Brand name** | **rotli** (lowercase, always). A warm, friendly, rounded wordmark. |
| **What it is** | A modular, hotkey-driven, **local-first productivity app for Mac** — Notes · Inbox · Wiki · Voice · Board in one menu-bar shell. Bundles its own LLM/STT/TTS; nothing to install but rotli. |
| **Audience** | People with busy, scattered digital lives (many inboxes, notes across six apps) who want **cognitive quiet** — a calm tool that holds what matters and gets out of the way. Personal-first, not team-first. |
| **Brand essence** | **Warm, quiet, instant.** A visitor on your screen, not a resident. |
| **Mascot / metaphor** | The **quokka** on Rottnest Island — small, focused, always smiling because the island was designed *for it*. The app is the island; every module is part of it; nothing has to be learned. |
| **Values** | QUIET (calm beats busy) · WARM (lamplit, never clinical) · INSTANT (anticipates you) · YOURS (local-first; rebindable; the user owns the app). |
| **Locked logo mode** | **Lowercase rounded wordmark `rotli`** + a **secondary `r` mark** (the distinctive curled-tail r). *(see §2)* |

---

## 1 · What the mark must carry

One feeling: **warm calm** — friendly, soft, unhurried, made-for-you. The opposite of cold productivity
SaaS. Rounded, approachable, lamplit. It should look like paper under a desk lamp, not a monitor under an
LED. The quokka smile is implicit in the roundness; the mark never has to shout.

---

## 2 · The LOCKED logo direction — `rotli` wordmark + `r` mark

**MODE: a lowercase, rounded, friendly wordmark with one signature letterform — the `r`.**

The specific concept (Seth-confirmed via the brand board):

> **Primary:** the full word **`rotli`** set lowercase in a warm rounded sans, in **Cocoa `#3A3028`**. The
> leading **`r` is the signature glyph** — its arm sweeps up and curls with a distinctive looped tail (a
> calm, almost hand-drawn flourish), giving the otherwise simple wordmark its personality. Letters are
> even-weighted, generously rounded terminals, comfortable spacing.
>
> **Secondary:** the **`r` mark alone** — the same curled-tail `r`, used as the compact app/menu-bar/
> favicon/avatar mark where the full word won't fit. It is the brand's atom and must stand alone.

**Decoded into rules for the engine:**

1. **FORMALIZE FROM SOURCE — do not trace the raster.** The board is Seth's judgment, not the vector
   source. Get the wordmark + `r` mark as clean outlined SVG from Seth's design source (Figma/AI export),
   or rebuild the `r` glyph as exact path geometry. Never auto-trace the board PNG.
2. **The `r` is the signature.** Its looped/curled tail is the one distinctive move — preserve it exactly;
   everything else stays calm and even.
3. **Outline the wordmark to SVG paths** (font-independent, portable) so the lockup never depends on a
   webfont loading — same approach as every smLab kit.
4. **Two masters:** a **MONO** single-color master (knockout/reversal) **and** the brand-color version
   (Cocoa on Linen; Linen/Peach on Cocoa for dark).
5. **Survival floor:** the secondary `r` mark must read at **16px mono** (favicon) and as a **knockout**.
   If the curl muddies at 16px, simplify the tail until it holds — the eye + Seth decide, no metric.

**Required variations (the kit must ship all):** wordmark full-color · wordmark mono-black · wordmark
mono-white/reversed · `r` mark full-color · `r` mark mono-black · `r` mark mono-white · light tile (Linen)
· dark tile (Cocoa) · clay tile · favicon/app-icon (the `r` mark, no wordmark) · social avatar (`r` on a
tile, centered, safe margin) · menu-bar/tray template mark (monochrome, macOS template-icon style).

> **Note on the prior identity (REJECTED / retired):** the earlier rotli direction used a **copper
> `#B87A4E`** accent, **Cabin 600**, and a **quokka-face tray icon**. That is **superseded** by this board.
> Do not reuse the copper/Cabin system. The quokka stays as the brand *metaphor/voice*, not necessarily as
> the literal logo (the curled `r` is the mark now).

---

## 3 · Brand color (tiered — core · supporting · semantic surfaces)

The five approved colors (the board):

| Token | Hex | Name | Role |
|---|---|---|---|
| **`--rotli-cocoa`** | **`#3A3028`** | Cocoa | Primary text / ink · wordmark · dark-ground base. |
| **`--rotli-clay`** | **`#C97E62`** | Clay Blush | The one signature accent — active states, progress, key moments. |
| `--rotli-peach` | `#F2D6C2` | Peach Cream | Warm tint — selected rows, highlights, accent backgrounds. |
| `--rotli-linen` | `#F8F2E9` | Linen | Lightest warm surface / light ground (never pure white). |
| `--rotli-olive` | `#8D9A76` | Olive Moss | Secondary / success accent — checkmarks, sync, "all caught up". |

**Surfaces.** Light: ground Linen `#F8F2E9`, surface `#FFFFFF`, surface-2 `#F1E7D8`, text Cocoa `#3A3028`,
muted `#6E6155`, border `#E7DBC9`, accent Clay `#C97E62`, accent-text (AA, small) `#8F4E37`, tint Peach
`#F2D6C2`. Dark (warm, never clinical): ground `#241D18`, surface `#2E2620`, surface-2 `#392F28`, text
`#F1E7DA`, muted `#B7A593`, border `#3D3229`, accent Clay `#C97E62` (clears AA on the cocoa ground).

**Tier discipline.** Brand core = Cocoa (ink) + Clay (accent). Supporting = Olive (success/secondary) +
Peach (tint) + Linen (ground). Clay is **punctuation and warmth — not a field**; never two clay elements
competing at once; never body text. Don't over-spend hues. Ship a real contrast matrix (in `colors.json`).

---

## 4 · Wordmark

`rotli`, lowercase, rounded, **Cocoa `#3A3028`** on light (Linen/Peach on dark). The curled-tail `r` is
the whole idea — the wordmark and the secondary `r` mark visibly share that one signature glyph. Outlined
to SVG paths (font-independent, portable). No shadows, no bevels — restraint is the posture; warmth comes
from the curves, not from ornament.

**Lockups:** wordmark-only · `r` mark only · horizontal (`r` mark + wordmark) · stacked (`r` mark above
wordmark). Plus a reversed (knockout) horizontal for dark grounds.

---

## 5 · Fonts — direction set, licensing to confirm

- **Display + headings + wordmark:** **Satoshi** (Bold). Geometric-humanist, warm, rounded — matches the
  wordmark's character.
- **UI + body:** **General Sans** (Regular / Medium). Clean, friendly, legible at small sizes.
- **Fallback:** **Inter** / `-apple-system`.
- **Licensing:** both Satoshi and General Sans are **Fontshare (Indian Type Foundry)** faces — free for
  personal **and** commercial use under the Fontshare/ITF Free Font License. Self-host (download from
  Fontshare). **Caveat:** they are **not OFL** and are **not** in smLab's current Fontsource catalog
  (Mona Sans / Figtree / Inter). This is a deliberate, Seth-approved deviation for rotli — record it in
  `LICENSES.md` at freeze. The wordmark ships **outlined**, so the font is only needed for live UI text.
- *OFL fallback option (if a strictly-OFL path is later wanted):* the nearest free rounded-humanist swaps
  for live UI text would be evaluated then — a one-line change since the wordmark is outlined.

---

## 6 · Type scale (from the board)

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--fs-heading` | 32 / 40 | Satoshi **Bold** (700) | Headings, hero |
| `--fs-subhead` | 20 / 28 | Satoshi **Medium** (500) | Subheadings, lead-ins |
| `--fs-body` | 14 / 22 | General Sans **Regular** (400) | Running text, note body |
| `--fs-label` | 12 / 16 | General Sans / Satoshi **Medium** (500) | UI labels, chips, nav |

A larger display step above `heading` may be added for marketing/empty-state moments.

---

## 7 · Taglines (provisional — to be set with Seth)

Drawn from the philosophy: "**I will quietly hold what matters, and I will not get in your way.**" ·
"**Warm. Quiet. Instant.**" · "**Your island.**" (the quokka metaphor). Not locked.

---

## 8 · The icon system (the board's set — full contract in `kits/rotli/icons/README.md`)

One cohesive family; **outline style**, consistent stroke, on a fixed grid; one idea each; a **hover label
on every icon** (the quokka principle — no learning the island's secret symbols). Accent sparingly with
**Clay** (and **Olive** for success/sync). The approved set names **ten** icons (each maps to a product
surface): **Text Notes · Sheets · Quick Notes · Calendar · Transcript · Action Items · Tags · Reminder ·
Sync · Search.** Draw on the 24-grid → sprite, per `RULES/02-iconography.md`.

---

## 9 · Brand pattern + graphic elements (provisional)

Warm and quiet, not busy. Candidates (to explore at the pattern step): a soft **dot/paper grain** texture
(lamplit tooth, very low opacity); the **curled-`r`** flourish as a sparing repeated motif; gentle rounded
**tag/pill** shapes echoing the UI. Construct programmatically; keep opacities below conscious perception.

---

## 10 · Naming rule

**`rotli`** — lowercase, always, in copy and UI. The rounded lowercase wordmark *is* the identity. Don't
capitalize it ("Rotli") in product copy; sentence-start capitalization is the only exception, and even
then prefer rephrasing so the lowercase mark leads.

---

## 11 · Reject list

The retired copper `#B87A4E` accent · Cabin 600 · the old quokka-face tray icon as the literal logo ·
"Rotli"/"ROTLI" casing in UI · any cold/clinical grey · pure white in light mode · two clay elements
competing · auto-tracing the board raster · over-spent hues · any mark that dies at 16px mono.
