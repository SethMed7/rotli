# Launch video plan — 2026-10-05

Prep only. Nothing here is rendered yet. The owner wants the home page's product
film redone as a polished launch video. It should have no caption bar along the
bottom, and it should use modern cuts that go back and forth between the app and
short typographic cards to explain the features. This plan covers what will be
in rotli at launch, how each shot is captured and cut, and what has to land
before it can be made. It follows on from PR 1 in
[the landing + app round](landing-and-app-round-2026-10-02.md).

## What it replaces

The current hero film (`site/public/media/hero/rotli-hero.mp4`, `hero` in
`site/src/films.ts`) is one continuous Rotli Web session recorded by
`bun run capture:hero` (`scripts/capture-hero.mjs`). It renders the app at
1280 × 612 CSS px × 1.5 and keeps a 162 px band under it for burned-in one-line
captions. `FilmPlayer.astro` reserves that band with `captioned` (`--caption-band:
15%`). The new film drops the band, so the app fills the full 1920 × 1080 frame
and the words move into cards and in-frame labels (below).

## What it shows

Shown at launch, in this order of importance:

1. **Markdown notes.** Writing renders as you type: tasks, a table, a
   `[[link]]`, a pasted image. Aa shows the plain Markdown underneath.
2. **The Librarian filing.** A messy note gets its frontmatter (area, summary,
   tags, links) and a place in the Library, and the body stays as typed.
3. **Chat.** A question answered from the vault's own notes, with the notes it
   read.
4. **Docs and Sheets, beta.** A Word file and an Excel workbook opening and
   taking an edit in the Mac app. Always labelled "Beta" on screen, with the
   word taken from `DOCS_AND_SHEETS` in `site/src/site.ts`.
5. **Boards.** An Excalidraw board beside the notes.
6. **Themes.** Two or three families, light and dark, in quick cuts.
7. **Rotli Web and Rotli Helper.** The same vault in a browser, and the one
   Terminal line.

Optional, at the end of the cut so they can drop out without retiming anything
before them. Include them only if they have shipped by capture day (another
thread is building both):

8. **Charts.**
9. **`/ai`** in a note.

Not shown: anything that is dev-build only on capture day (agents/MCP, Breve,
Mermaid visual editing, read-aloud), Windows or Linux apps (coming soon), and any
real person's data.

## Shot list (about 62 s, room for 45–75 s)

The rhythm is a card, then the app proving it, then the next card. Cards are
short (1.2–2 s). App shots carry the time. Every cut is a hard cut or a quick
push (no dissolves longer than 6 frames). Times are approximate; the edit
decision list fixes them.

| # | Time | Kind | What's on screen | Source |
|---|---|---|---|---|
| 1 | 0.0–1.6 | Card | "Write like a person." | type |
| 2 | 1.6–6.5 | App | ⌥Space opens a quick note; a fast, messy note is typed with two tasks and a `[[Lisbon trip]]` link. Markdown renders as it goes | Mac |
| 3 | 6.5–8.0 | Card | "Let AI do the filing." | type |
| 4 | 8.0–14.0 | App | The Librarian files it: frontmatter fields appear at the top (in-frame label: "Added by the Librarian"); the body is untouched; the note lands in Library › Travel | Mac (live run) |
| 5 | 14.0–15.4 | Card | "Your words stay yours." | type |
| 6 | 15.4–18.5 | App | Aa: the same note as plain Markdown, then Finder showing the `.md` file in the folder | Mac |
| 7 | 18.5–20.0 | Card | "Ask your notes." | type |
| 8 | 20.0–27.0 | App | Chat: "What's still open for Lisbon?" Answer streams in, built from the vault's notes, which are listed under it | Mac (connected model) or Web (fake Helper) |
| 9 | 27.0–28.4 | Card | "Docs and Sheets. Beta." | type |
| 10 | 28.4–33.5 | App | A `.docx` opens and takes one edit; cut to an `.xlsx` with a formula edit. Small "Beta" label inside the frame each time | Mac |
| 11 | 33.5–37.0 | App | An Excalidraw board beside the note (no card; the cut itself is the change) | Web or Mac |
| 12 | 37.0–38.4 | Card | "Make it yours." | type |
| 13 | 38.4–42.0 | App | Three theme families, light then dark, 0.6 s each, same frame | Web |
| 14 | 42.0–43.4 | Card | "In your browser, too." | type |
| 15 | 43.4–49.0 | App | Rotli Web opens the same vault; a cut to the Helper's one Terminal line; back to the note | Web + Terminal |
| 16 | 49.0–52.0 | App | (optional) A chart in a note | Mac or Web |
| 17 | 52.0–55.0 | App | (optional) `/ai` in a note | Mac |
| 18 | 55.0–58.0 | Card | "Free. No account. Works offline." | type |
| 19 | 58.0–62.0 | End card | Wordmark, "rotli.co", Download for Mac / Open in your browser | type |

Without 16 and 17 the film runs about 56 s. If the cut runs long, drop shot 6
before shortening shots 4 or 8; the filing and the chat are the reasons for the
film.

## How the words appear

- **No subtitle strip.** Nothing sits in a band at the bottom of the frame.
- **Cards between cuts.** Full-frame type on the site's own ground (Rotli
  Light; one dark card is fine for the privacy beat). General Sans 600 at
  display size, one line, no more than six words, and no eyebrows or kicker
  labels above them. They are written plainly, the way the site is: no
  triplet slogans, and nothing the product doesn't do.
- **Labels inside the frame.** Used sparingly (shots 4 and 10 only), as a
  small pill pinned near the thing it names ("Added by the Librarian",
  "Beta"), and it never covers the UI it describes.
- **Readable on a phone.** The site plays the film about 350 px wide on a
  phone, so card type is at least 120 px tall at 1080p, and labels are at
  least 40 px.
- **Accessible.** The player keeps a text description (`label` in
  `films.ts`), rewritten for the new cut. Ship a WebVTT track with the card
  text so it can be switched on, but don't burn captions in.

## Capture method

All footage comes from synthetic vaults. No live vault, no installed app, and no
real names, paths, or accounts in frame (this repository is public).

- **Rotli Web shots (8 as fallback, 11, 13, 15).** Extend the existing
  `scripts/capture-hero.mjs` pattern: Playwright drives a local
  `ROTLI_BUILD_CHANNEL=stable bun run dev:web`, clicks real controls with a
  drawn pointer, and writes into a fresh origin-private vault of synthetic
  notes. Chat runs through the fake Rotli Helper on loopback (the
  `e2e/web/rotli-helper.spec.ts` pattern), so only the model's words are
  scripted. Change the capture to the full 1920 × 1080 frame (`VIEW` 1280 ×
  720 at 1.5×) with no band, and record each shot as its own take instead of
  one session, so the edit can cut between them.
- **Mac shots (2, 4, 6, 10, 16, 17; 8 preferred).** These need the desktop
  app: the Librarian, Docs, Sheets, ⌥Space, Finder, and the on-device model
  don't run in Rotli Web. Use an isolated stable-channel development build on
  a synthetic vault with the registry backed up and restored (the
  `validate-in-the-native-app` skill), screen-recorded at 2× on a 1440 × 900
  logical window. For shot 4 the vault needs an existing `wiki/Travel/` area
  so the Librarian has somewhere to file, and the Librarian's quiet window
  has to be short enough for Run now to pick the note up. Run these
  recordings outside the owner's working hours (no computer-use while he
  works).
- **Editing.** HyperFrames, as for the September promo. The edit project
  (the `edl.json` cut list, `prepare.mjs`, `index.html`, `audio/synth.py`,
  and `scripts/hyperframes-local.mjs`, which every HyperFrames command must go
  through) is kept in the studio repository at
  `archive/films/launch-film/hyperframes/`. Its renders and vendored GSAP sit
  in the gitignored `marketing/hyperframes/` on the maintainer's Mac. Neither
  is in this repository. Copy the project to a fresh folder for this film
  rather than editing the archived one. Two renderer traps from September
  still apply: only the first `<video>` in a container gets frames on render,
  so `prepare.mjs` should join the takes into one `play-take.mp4` with dense
  keyframes (`-g 15`); and a seek far from a keyframe renders blank, so check
  the render with a frame-luminance scan, not only `snapshot`.

## Music and sound

The site plays the hero film muted, once, and the player has no sound control
for a silent film. Ship the hero cut **silent**, as now (`silent` in
`films.ts`): it must make sense with no sound. Make a second mix with a quiet
bed and small UI sounds (key taps, the filing "settle", the card cuts) for
social posts and YouTube, built with the existing `audio/synth.py` approach
(original, synthesized, no licensed music), at about −16 LUFS. No voiceover.

## Aspect ratios and files

| Cut | Size | Where | Notes |
|---|---|---|---|
| Hero | 1920 × 1080, 16:9, 30 fps | home page and /features/ | silent, H.264 `+faststart`, under 6 MB, poster from shot 4 |
| Social | 1080 × 1920, 9:16, 30 fps | Reels, Shorts, X | with sound; the app shots re-framed (cropped to the editor column, not letterboxed), cards re-set for the tall frame |
| Optional | 1080 × 1350, 4:5 | feed posts | only if the 9:16 crops hold |

Mac and Web takes are recorded wide enough that a 9:16 crop of the editor
column still reads. Check that on every take before you start editing.

## Site changes when it lands

- Replace `site/public/media/hero/rotli-hero.mp4` and its poster. Set
  `captioned` off for `hero` in `site/src/films.ts`, so `FilmPlayer` stops
  reserving the band, and rewrite `label` for the new shots.
- Update `site/README.md` ("Films") and the CHANGELOG.

## What blocks it

- **Sheets in production.** Shot 10 waits until XLSX leaves development
  builds (another thread). Docs and Sheets show only with the Beta label.
- **Charts and `/ai`.** Shots 16 and 17 are cut unless both have shipped by
  capture day.
- **The capture script.** `capture-hero.mjs` needs the full-frame, per-shot
  mode described above. That is a change to the repository, with its own
  review.
- **Native capture setup.** A stable-channel development build and a
  synthetic vault with a filing area, recorded outside the owner's working
  hours.
- **The owner's review** of the treatment (this shot list and the card words)
  before capture, and of the rough cut before the final render.
