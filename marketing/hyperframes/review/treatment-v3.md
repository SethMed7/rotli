# rotli launch film — third cut treatment (vision-led, energetic)

Status: treatment and music direction only. The picture re-cut waits on the
maintainer's screenshots of the rendering regressions (2026-09-10) and their
fixes; footage is captured after that so the film never shows a known bug.

## The story in one breath

One folder is your vault, and it stays in the background. The Librarian keeps
it organized, wiki-style. You work in your own views and arrange files however
you like. When you jump to Chat, the model has what it needs. Built for the
human and for the AI.

## Arc (about 45 s at 104 BPM; every cut lands on a beat)

| Beat | Time | Picture (all synthetic, browser twin) | Caption |
|---|---|---|---|
| Cold open | 0–4.6 | Linen. Three lines land on three hits: "One folder." / "Your vault." / "Room to think." | the lines |
| The vault, then the work | 4.6–9.2 | Drop: full workspace arrives on the downbeat. One reframe from the sidebar's Library areas (People · Projects · Research) out to the note. | One folder is the vault. It stays in the background. |
| The Librarian | 9.2–13.8 | The real "About the Librarian" explainer, then the Library tree. | The Librarian files your notes, wiki-style. Location and metadata, never your words. |
| Your views | 13.8–18.4 | Main → "New view…" → name it → add the note (real controls, recorded). | Work in your own views. Arrange files however you want. |
| Write | 18.4–27.6 | Recorded typing in one note, music at full energy, cuts every two bars: `/` opens the slash menu → Table; `[][]` + Space → result row, click the X; `[True:green][Draw:yellow][False:red]` → colored labels, pick Draw; `[/]` in-progress; `[#]` choice group; `[|]` switch; backticks stay literal; a table cell edited and a column dragged. | Markdown that renders as you type. / Results, choices, switches. Plain text underneath. / Tables you can edit in place. |
| Draw | 27.6–31.2 | New → Excalidraw board, two shapes and an arrow drawn (recorded); a Mermaid fence rendering inline (View only, no editor). | Boards and diagrams live beside your notes. |
| Chat | 31.2–36.0 | The real Home/Chat press; the Chat front. | Jump to Chat. It gets the context you select, nothing more. |
| Themes | 36.0–39.5 | Six families, one per half-bar, riser underneath. | Six theme families, light and dark. |
| Built for both | 39.5–45.0 | Hit. Dark card: "Built for you. And for the AI." → "Room to think. Files you keep." / "Mac beta in preparation" / rotli.co. | the card |

Claims to keep honest: the Librarian beat shows the explainer and the Library
tree, not a live filing run (the twin has no organizer). Chat is navigation,
never a response. Mermaid renders; the Visual editor is development-only and
is not shown. No "download".

## Footage to capture (extend `scripts/capture-launch.mjs`, synthetic only)

1. Note: Library tree expanded in the sidebar; the Librarian explainer open.
2. Main → New view… → "Launch" → add a Welcome lesson (real menu and dialog).
3. Writing take in the Welcome folder's Tasks lesson: slash menu → Table; the
   expansions above typed with visible cadence; clicks on X, Draw, choice,
   switch; a table cell edit; a column-boundary drag.
4. New → Excalidraw board → name → rectangle, rectangle, arrow via the toolbar.
5. A Mermaid fence typed, rendered inline; no workspace opened.
6. Home/Chat press (already recorded; recapture in the same session).
7. Six theme captures (existing site captures).

All at 2880×1800 lossless frames with real timestamps, as today.

## Music direction (audio/synth.py, `energetic` bed)

104 BPM, D major. Cold open: a bright 16th-note arpeggio under a filter that
opens on each headline hit. Drop at the app's arrival: soft four-on-the-floor
kick, bass on the root, chords in the pads, hats on the off-beats. The writing
montage carries the lead motif (D–F#–A answered by B–A) over the arpeggio.
A two-bar riser into the end card, one full hit with a long tail, resolve on
the last frame. Delivered mix target −15 LUFS integrated, true peak ≤ −1.5 dBTP
(the previous cut sat at −19 LUFS, which read as quiet on laptop speakers).
Tactile sounds stay on recorded actions only; hits, not whooshes, mark cuts.
