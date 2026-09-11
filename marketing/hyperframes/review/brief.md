# rotli launch promo — storyboard brief for read-only creative review

You are reviewing a storyboard for a 44-second product promo. Please critique it
as a senior creative director and motion editor. **Read-only critique only: do
not run tools, do not browse the web, do not read files, do not write files.**
Everything you need is in this brief. Reply in Markdown with concrete, numbered
recommendations. Be specific about timings, wording, and treatment; say what to
cut, what to keep, and what to change. Flag anything that reads as generic
startup-template, dishonest, or hard to read.

## Product facts you may rely on (public only)

- rotli (always lowercase) is a calm, local-first Mac workspace. One ordinary
  folder is the vault; notes are plain Markdown files the user keeps.
- Public launch focus: notes and chat. Writing, tasks, links, optional
  context-aware chat, six theme families (Rotli, Paper & Charcoal, Ocean, Grove,
  Iris, Midnight; each tuned light and dark), an app-owned Playground with ten
  practice lessons, local plain files.
- Chat is optional: an on-device model or a connected tool the user already
  trusts. Connected chat can send selected context, so the film must never say
  "never leaves your Mac".
- Do not market: Breve (development-only), DOCX/spreadsheet fidelity, a relay,
  image generation, or downloads. There is no "Download now". Status line is
  "Mac beta in preparation".
- Voice: calm, plainspoken, warm, no hype, no gamification. Tagline: "Room to
  think. Files you keep."
- Brand: General Sans (body/display), Baloo 2 wordmark for "rotli", palette
  linen ground #F8F2E9, cocoa ink #3A3028, clay accent #C97E62 (as fills or
  large only; #8F4E37 for small accent text), muted #6E6155, olive #8D9A76.
  Flat material: no shadows, glows, blur, 3D, decorative grids, or wipes.
- Approved visuals: six real synthetic app captures (the same demo note in six
  themes, 3840x2400), one Playground capture (Tasks and progress lesson,
  4320x2700), and the canonical quokka drawings. No chat transcript capture
  exists, so chat must be shown honestly with the real Home/Chat control, not a
  mocked conversation.
- Output: 1920x1080 H.264, 30 fps, ~44 s, with on-screen captions for every
  beat, original synthesized music and SFX. It must also work muted. Narration
  may be added later, so the mix needs headroom.

## Storyboard (times in seconds)

### Act 1 — Typographic opening, linen ground (0.0–10.0)

| Time | On screen | Motion |
|---|---|---|
| 0.0–2.3 | "One folder." (General Sans 600, ~150 px, cocoa) | rises 24 px and fades in over 0.6 s |
| 2.3–4.6 | "Plain files." appears below; "One folder." dims to muted | same entrance; earlier line settles to #6E6155 |
| 4.6–7.4 | "Room to think." appears larger (~190 px), earlier lines stay muted above it | entrance with slight scale 0.98→1 |
| 7.4–10.0 | All lines clear; quokka line mark + "rotli" wordmark (Baloo 2) land center; small line under: "A calm, local-first workspace for your Mac." | mark and wordmark land with a soft pop SFX at 7.6 |

Captions for VTT/SRT here are the headline texts themselves (no separate bar).

### Act 2 — Product (10.0–41.0). Product shots sit in a flat frame (1 px border,
14 px radius) on linen; every hold keeps a slow 1–3% scale drift or pan so
nothing freezes. Caption bar: cocoa pill, linen text, 40 px General Sans 500,
bottom-centered, 64 px safe margin, max two lines.

| Time | Shot | Caption | Motion / SFX |
|---|---|---|---|
| 10.0–13.4 | Warm Light capture, full app, 1640 px wide | "Write in plain Markdown. Notes stay ordinary files in a folder you choose." | crossfade in from wordmark; scale 1.00→1.03 |
| 13.4–17.0 | Same capture, pan/zoom (~1.75×) into the note heading, paragraph, and task list. Stays above the blockquote area on purpose. | "Headings, tasks, and formatting render in place. The file underneath is still text." | eased zoom over 1.2 s, then slow drift |
| 17.0–20.4 | Playground capture zoomed (~2×) on the three task rows (open / in-progress / done) | "Tasks and progress live inside the note." | crossfade; soft wooden click at 18.2 as the done task lands |
| 20.4–23.0 | Pan down to the Results rows (check/X, True/False, True/Draw/False) | "Check, choose, decide. Plain Markdown records the answer." | eased pan; soft click at 20.8 |
| 23.0–25.2 | Warm Light capture crop of the sidebar nav (All notes, Captures, Tasks) at ~1.6× | "Tasks gather in one view. Notes link to each other." | crossfade; drift |
| 25.2–27.2 | Pan to the titlebar search field (quokka mark, "Search…", ⌘K) | "⌘K finds anything in the folder." | eased pan |
| 27.2–31.2 | The real Home / Chat segmented control cropped large (~2.4×) on the left; canonical "quokka with laptop" drawing (~400 px) on the right | 27.2–29.4: "Chat is optional: an on-device model or a tool you already trust." 29.4–31.2: "It can read context you choose. Your notes are useful without it." | crossfade; no fake transcript |
| 31.2–37.4 | Six theme captures in sequence, 1.0 s each with 0.25 s crossfades: Rotli Warm Light → Paper → Ocean Light → Grove Dark → Iris Light → Midnight. Small label chip inside the frame names each. | "Six theme families, each tuned for light and dark." | soft airy transition on each cut (quiet, alternating pitch) |
| 37.4–41.0 | Playground capture, full app | "Start in the Playground. Save a lesson to your files only when you want to." | crossfade; scale 1.00→1.03 |

### Act 3 — End card, dark cocoa ground #241D18 (41.0–44.0)

Quokka mark + "rotli" wordmark in linen; "Room to think. Files you keep."
(General Sans 600, ~72 px); "Mac beta in preparation" (muted #B7A593);
"rotli.co" (clay #C97E62, large). Wordmark lands with the same soft pop at 41.4.
Music resolves at 41.4 and tails out by 44.0.

## Audio concept

- Original synthesized music bed (numpy, seeded): warm felt-piano-like plucked
  tones (sine + soft harmonics, fast attack, exponential decay) playing a slow
  arpeggio at ~76 BPM in D major, over a soft detuned pad and a quiet sub root.
  Sparse during the opening, arpeggio joins at 10 s, slightly brighter during
  the theme sequence, settles at 37 s, final resolved chord at 41.4 s with a
  2.5 s release. Target about −18 LUFS integrated, true peak ≤ −3 dBTP, so a
  later narration track can sit on top.
- SFX: soft wooden click (task lands), soft pop (wordmark lands), quiet airy
  transitions (theme cuts). No metronomic ticks, no tinny beeps.
- Everything must read muted; music and SFX only add satisfaction.

## Questions to pressure-test

1. Does the opening earn its 10 seconds, or should the three-phrase build be
   tighter? Is "One folder. / Plain files. / Room to think." the right ladder?
2. Are any captions too long for two lines at 40 px, or too vague? Suggest
   tighter wording where you can, keeping the brand voice and the claims honest.
3. Shot treatment: is the pan/zoom plan readable at 1080p? Any hold too short?
   Any moment where the crop would feel like a "fake mock"?
4. The chat beat uses the real control plus a drawing rather than a transcript.
   Does that read as honest and interesting, or as a gap? Alternatives within
   the constraints?
5. Six themes in 6.2 s: right pace? Should the label chip live inside or outside
   the frame?
6. Audio: does the concept risk feeling like a stock template? What would make
   the clicks and transitions feel tactile rather than gimmicky?
7. End card: anything missing or excessive? Anything that violates the
   prelaunch rules above?
8. Overall arc and total length. Would you cut a beat, and which?
